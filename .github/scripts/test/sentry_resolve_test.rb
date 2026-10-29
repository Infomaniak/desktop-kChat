# frozen_string_literal: true

# Tests des fonctions pures de l'orchestrateur desktop sentry_resolve.rb.
# Run: ruby .github/scripts/test/sentry_resolve_test.rb

require 'minitest/autorun'
require_relative '../sentry_resolve'

describe 'tag_kind' do
  it 'stable = tag nu' do
    _(tag_kind('6.0.0')).must_equal :stable
  end

  it 'rc = suffixe -rc.N (paire same-SHA de beta, skip)' do
    _(tag_kind('6.0.0-rc.1')).must_equal :rc
  end

  it 'alpha et beta = prereleases utilisateurs (resolve)' do
    _(tag_kind('6.0.0-alpha.1')).must_equal :prerelease
    _(tag_kind('6.0.0-beta.14')).must_equal :prerelease
  end
end

describe 'partial_delivery_blockers' do
  it 'detecte les MRs ouvertes qui revendiquent le meme ticket' do
    mrs = {
      'webapp' => [{ 'iid' => 101, 'description' => 'Fixes RM-111111' }],
      'desktop' => [],
      'mobile' => [{ 'iid' => 303, 'description' => 'bare mention https://redmine.infomaniak.ch/issues/111111' }]
    }
    _(partial_delivery_blockers('111111', mrs)).must_equal ['webapp !101']
  end
end

# Redmine write stubs: RM-111111 fails (transient 5xx), the others succeed.
def leave_comment_on_redmine_ticket(issue_id, _comment)
  raise StandardError, 'stub redmine 5xx' if issue_id == '111111'

  true
end

def update_redmine_ticket_status(_issue_id, _status)
  true
end

def fetch_open_mrs_by_repo
  nil
end

describe 'handle_stable_redmine' do
  it 'returns true (WARN signal) when a ticket fails, and still processes the next one' do
    merged_mrs = [{ 'description' => 'Fixes RM-111111 and RM-222222' }]
    _(handle_stable_redmine(merged_mrs, '1.2.3')).must_equal true
  end

  it 'returns false when every ticket is processed' do
    merged_mrs = [{ 'description' => 'Fixes RM-222222' }]
    _(handle_stable_redmine(merged_mrs, '1.2.3')).must_equal false
  end
end
