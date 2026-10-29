# frozen_string_literal: true

require 'json'
require 'net/http'
require 'open3'
require 'set'
require 'time'

require_relative 'sentry_refs'
require_relative 'sentry_api'

# Sentry + Redmine resolution at desktop release time (GitHub Actions).
# "Fixes <REF>" convention (see sentry_refs.rb): resolve at the tag,
# GET-first, fail-open, triage protected, Redmine on stable/store only.

GITLAB_API_BASE = ENV['GITLAB_BASE_URL'] ? "#{ENV['GITLAB_BASE_URL']}/api/v4" : 'https://gitlab.infomaniak.ch/api/v4'
GITLAB_ACCESS_TOKEN = ENV['GITLAB_API_TOKEN']
# Single source of truth lives in SentryRefs (extraction and writes aligned).
REDMINE_DOMAIN = SentryRefs::REDMINE_DOMAIN
REDMINE_API_KEY = ENV['REDMINE_API_KEY']
TAG = ENV['GITHUB_REF_NAME'].to_s

STABLE_DELIVERY_GUARD_REPOS = ['webapp', 'desktop', 'mobile']

def get_http(uri)
  Net::HTTP.new(uri.host, uri.port).tap do |http|
    http.use_ssl = true
    http.verify_mode = OpenSSL::SSL::VERIFY_PEER
    http.open_timeout = 10
    http.read_timeout = 60
  end
end

def tag_kind(tag)
  return :stable if /\A\d+\.\d+\.\d+\z/.match?(tag)
  return :rc if tag.match?(/\A\d+\.\d+\.\d+-rc\.\d+\z/)

  :prerelease
end

# Previous tag of the chain (parent of the tag commit, nearest reachable tag).
# Array form (no shell): the tag name comes from GITHUB_REF_NAME and must never
# be interpolated into a command string.
def previous_tag_name
  name, = Open3.capture2('git', 'describe', '--tags', '--abbrev=0', "#{TAG}^", err: IO::NULL)
  name = name.strip
  name.empty? ? nil : name
end

def tag_commit_sha(tag)
  sha, = Open3.capture2('git', 'rev-list', '-n', '1', tag, err: IO::NULL)
  sha.strip
end

def gitlab_merged_mrs_between(from_sha, to_sha)
  commits_range = `git log --format='%H' #{from_sha}..#{to_sha}`.split("\n").to_set
  puts "desktop-resolve: #{commits_range.length} commits in range #{from_sha}..#{to_sha}"
  return [] if commits_range.empty?

  merged_after_param = nil
  from_date = `git show -s --format=%cI '#{from_sha}'`.strip
  if from_date && !from_date.empty?
    merged_after_param = begin
      (Time.parse(from_date) - 86_400).utc.iso8601
    rescue StandardError
      nil
    end
  end

  all_mrs = []
  page = 1
  loop do
    query = "state=merged&target_branch=master&per_page=100&page=#{page}"
    query += "&merged_after=#{URI.encode_www_form_component(merged_after_param)}" if merged_after_param
    uri = URI.parse("#{GITLAB_API_BASE}/projects/kchat%2Fdesktop/merge_requests?#{query}")
    request = Net::HTTP::Get.new(uri.request_uri)
    request['PRIVATE-TOKEN'] = GITLAB_ACCESS_TOKEN

    response = get_http(uri).request(request)
    raise "GitLab MRs => HTTP #{response.code}" unless response.code.to_i == 200

    batch = JSON.parse(response.body)
    break if batch.empty?

    all_mrs.concat(batch)
    page += 1
    break if page > 20
  end

  matched = all_mrs.select do |mr|
    sha = mr['squash_commit_sha'] || mr['merge_commit_sha']
    sha && commits_range.include?(sha)
  end
  puts "desktop-resolve: #{all_mrs.length} merged MRs scanned, #{matched.length} in range"
  matched
end

# --- Redmine (stable only) ---------------------------------------------------

def redmine_request(issue_id, body)
  uri = URI.parse("https://#{REDMINE_DOMAIN}/issues/#{issue_id}.json")
  request = Net::HTTP::Put.new(uri)
  request.content_type = 'application/json'
  request['X-Redmine-API-Key'] = REDMINE_API_KEY
  request.body = JSON.dump({ 'issue' => body })

  response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https') do |http|
    http.request(request)
  end
  raise "Redmine PUT issue #{issue_id} => HTTP #{response.code}" unless response.is_a?(Net::HTTPSuccess)
end

def leave_comment_on_redmine_ticket(issue_id, comment)
  redmine_request(issue_id, { 'notes' => comment, 'private_notes' => false })
end

def update_redmine_ticket_status(issue_id, new_status_id)
  redmine_request(issue_id, { 'status_id' => new_status_id })
end

def partial_delivery_blockers(issue_id, mrs_by_repo)
  mrs_by_repo.flat_map do |repo, mrs|
    mrs.select { |mr| SentryRefs.extract(mr['description'].to_s)[:redmine_ids].include?(issue_id.to_s) }
       .map { |mr| "#{repo} !#{mr['iid']}" }
  end
end

def fetch_open_mrs_by_repo(repos = STABLE_DELIVERY_GUARD_REPOS)
  repos.each_with_object({}) do |repo, acc|
    mrs = []
    page = 1
    loop do
      uri = URI.parse("#{GITLAB_API_BASE}/projects/kchat%2F#{repo}/merge_requests?state=opened&per_page=100&page=#{page}")
      request = Net::HTTP::Get.new(uri.request_uri)
      request['PRIVATE-TOKEN'] = GITLAB_ACCESS_TOKEN
      response = get_http(uri).request(request)
      raise "open MRs #{repo} => HTTP #{response.code}" unless response.code.to_i == 200

      batch = JSON.parse(response.body)
      mrs.concat(batch)
      page += 1
      if batch.length == 100 && page > 5
        puts "desktop-resolve: WARNING more than 500 open MRs on #{repo}, truncated scan (degraded partial delivery guard)"
        break
      end
      break if batch.length < 100
    end
    acc[repo] = mrs
  end
rescue StandardError => e
  puts "desktop-resolve: WARNING open MR scan failed (guard disabled, historical behavior): #{e.message}"
  nil
end

def handle_stable_redmine(merged_mrs, version)
  issue_ids = merged_mrs.flat_map { |mr| SentryRefs.extract(mr['description'].to_s)[:redmine_ids] }.uniq
  open_mrs_by_repo = fetch_open_mrs_by_repo

  failed = false
  issue_ids.each do |issue_id|
    # Fail-open per ticket: a transient Redmine error must not abort the
    # remaining tickets of the batch.
    blockers = open_mrs_by_repo ? partial_delivery_blockers(issue_id, open_mrs_by_repo) : []
    unless blockers.empty?
      leave_comment_on_redmine_ticket(issue_id, "fix released in stable version #{version}, but partially delivered: the following MRs are still open with Fixes RM-#{issue_id}: #{blockers.join(', ')}. Status unchanged, it will move to status 3 once every MR of the batch is shipped.")
      puts "desktop-resolve: Redmine ##{issue_id}: partial delivery (#{blockers.join(', ')}), status unchanged"
      next
    end
    leave_comment_on_redmine_ticket(issue_id, "fix released in stable version #{version}")
    update_redmine_ticket_status(issue_id, 3)
    puts "desktop-resolve: Redmine ##{issue_id}: comment + status 3 (#{version})"
  rescue StandardError => e
    puts "desktop-resolve: WARNING Redmine ##{issue_id} not processed (fail-open): #{e.message}"
    failed = true
    next
  end
  failed
end

# --- Main --------------------------------------------------------------------

# Returns true when the report contains a warning (for kchat_notify on the
# workflow side): [sentry-hook] WARN line, cross-project, placeholder,
# configuration skip, or Redmine per-ticket failures.
def run
  unless sentry_configured?
    puts 'desktop-resolve: SKIP: SENTRY_URL/SENTRY_AUTH_TOKEN not configured'
    return true
  end
  if TAG.empty? || tag_kind(TAG) == :rc
    puts "desktop-resolve: SKIP tag #{TAG.inspect} (empty or -rc: duplicated ranges, see webapp convention)"
    return false
  end

  from_tag = previous_tag_name
  unless from_tag
    puts 'desktop-resolve: SKIP no reachable previous tag (first tag of the chain)'
    return false
  end
  from_sha = tag_commit_sha(from_tag)
  to_sha = tag_commit_sha(TAG)
  if from_sha.empty? || to_sha.empty?
    puts 'desktop-resolve: WARNING tag sha not found'
    return true
  end

  if GITLAB_ACCESS_TOKEN.to_s.empty?
    puts 'desktop-resolve: WARNING GITLAB_API_TOKEN missing, Sentry resolution + Redmine bookkeeping skipped'
    return true
  end

  merged_mrs = gitlab_merged_mrs_between(from_sha, to_sha)
  report = process_sentry_for_release(TAG, merged_mrs)
  report.each { |line| puts line }
  warned = report.any? { |line| line.include?('WARN') || line.include?('SKIP total') }

  if tag_kind(TAG) == :stable
    if REDMINE_API_KEY.to_s.empty?
      puts 'desktop-resolve: WARNING REDMINE_API_KEY missing, stable Redmine bookkeeping skipped'
      warned = true
    else
      warned = true if handle_stable_redmine(merged_mrs, TAG)
    end
  end
  warned
rescue StandardError => e
  puts "desktop-resolve: WARNING phase aborted (fail-open, the release continues): #{e.class}: #{e.message}"
  true
end

if $PROGRAM_NAME == __FILE__
  warned = run
  puts "SENTRY_RESOLVE_RESULT: #{warned ? 'WARN' : 'OK'}"
  exit 0
end
