# Release Notes — v3.5.0

**Released:** August 19, 2026  
**Previous release:** v3.3.3 (October 24, 2025)

---

## Highlights

- **Major platform upgrade:** Electron upgraded from v29 to v37.6.1, bringing significant performance, security, and compatibility improvements across all platforms.
- **New global permissions system:** App-wide permission management with a dedicated UI in Settings and the Edit Server modal.
- **8 new languages** added to the desktop app.
- **Sentry crash reporting** overhauled for better diagnostics and stability.
- **Bootstrap-free UI:** Progressively replaced all legacy Bootstrap/react-bootstrap components with native, modern alternatives.

---

## New Features

- **Do Not Disturb for calls:** Incoming calls are now silenced when Do Not Disturb is active.
- **Local proxy support:** Made using a local proxy easier and more discoverable.
- **8 new languages:** Added support for Danish, Greek, Finnish, Norwegian Bokmål, Dutch, Polish, Portuguese, and Swedish.
- **Avatar & sidebar initials:** Unified algorithm for normalizing avatars and sidebar initials across the app.
- **URL preview restoration:** Restored URL preview corners with live dark mode support.
- **Theme manager:** Implemented a proper theme change system with live switching and dark mode support.
- **Sidebar image retry:** Failed sidebar images now retry with exponential backoff.
- **Global permissions:** Permissions are now stored globally for the whole app instead of being scoped per-organization, with a full management UI in Settings and the Edit Server modal.
- **Sentry crash reporting:** Integrated Sentry with CriticalErrorHandler, added better app context to reports, and centralized init across all renderer processes.
- **Developer Mode settings:** A set of settings that allow turning off systems or forcing the app to behave in certain ways for debugging.
- **Plugin support:** Plugins can now open blank popup windows and ask for desktop sources for screen sharing.
- **Calls popout enhancements:** Context menu support and Desktop API exposed in the Calls popout window.
- **MSI downgrade support:** The MSI installer now supports downgrades.
- **Clear Data option:** Added "Clear Data" in the menu to force the app to clear session data.
- **Performance monitor:** Added CPU/memory usage collection sent via API.
- **Changelog link:** A changelog link is now shown when the app auto-updates.

---

## Bug Fixes

- Fixed Picture-in-Picture white screen in kMeet calls.
- Fixed screen sharing in kMeet caused by CORS issues.
- Fixed infinite CPU loop in automatic theme mode.
- Fixed idle polling continuing on lock/suspend, causing a memory leak.
- Aligned idle timeout to 5 minutes to match the backend.
- Fixed window controls overlay not updating on Windows when the theme changes.
- Fixed SAML and SSO redirects being blocked during login.
- Fixed downloads not honoring XDG `user-dirs.dirs` on Linux.
- Fixed kChat process not being killed during NSIS uninstall on Windows.
- Fixed window showing on startup when "hidden on login" is enabled on Windows.
- Fixed macOS crash when Focus Status permission is denied; added permission management UI.
- Fixed Windows notification name and icon.
- Fixed UserActivityMonitor not emitting inactive status; added system power events.
- Fixed login infinite redirect loop.
- Fixed settings modal backdrop misalignment caused by legacy Bootstrap CSS.
- Fixed traffic light theme not being responsive.
- Fixed kMeet window creating a duplicate when a call is already open (now switches to the existing one).
- Fixed devtools being enabled in production.
- Fixed Linux autostart by setting the correct APPIMAGE path.
- Fixed loader screen: centered the kChat logo and kept the status bar visible.
- Fixed permissions being asked too frequently.
- Fixed crash in the context menu component.
- Fixed loading screen covering open modals.
- Fixed URL view stealing focus from the current server view.
- Fixed loading screen flash between transitions.
- Fixed warning state color on the welcome screen URL input.
- Fixed the Download button being hidden on Windows/Linux.
- Fixed a crash on Linux when creating a thumbnail from an image.
- Fixed a potential crash when removing a server.
- Fixed issues with Windows notifications.
- Fixed the app not restoring when opened from cold and deep linking not working on Linux.
- Fixed window position having a decimal number.
- Fixed settings window disappearing on macOS when dragged to another monitor.
- Fixed incompatible server check defaulting to show the screen when server info is not present.
- Fixed media permissions on Linux.
- Fixed MAS migration from the DMG build and a potential crash case.
- Fixed crash on Windows caused by titlebar overlay.
- Fixed FIPS mode digest mismatch on Enterprise Linux.
- Fixed zoom-in shortcut to work with numpad `+`.
- Stopped autocompleting while the user is typing `https://`.
- Added error handling when FocusStatus is not authorized on macOS.
- Ensured the app reloads the current URL when reloading manually.
- Force window focus after navigation on notification click.
- Stopped logging the title/body of notifications.

---

## Security

- Removed `unsafe-inline` from internal CSP, replaced with nonce-based styling.
- Flipped Electron fuses for cookie encryption, node options, and ASAR integrity.
- Disallowed use of `file:` protocol in the app; added a custom protocol for local file access.
- Disallowed redirects to untrusted URLs without a permission prompt.
- Removed unnecessary macOS entitlements.
- Disabled `--inspect` on built applications.
- Security upgrade of `@aws-sdk/client-s3` and `cross-spawn` dependencies.

---

## Platform & Infrastructure

- **Electron upgrades:** v29.3.0 → v31.2.1 → v33.0.2 → v33.2.0 → v34.0.1 → v35.2.0 → v37.2.2 → v37.4.0 → v37.6.1.
- **Linux ARM64:** Added ARM64 cross-compilation and package support.
- **MSI installer:** Migrated to `electron-builder` for MSI creation; dropped support for 32-bit Windows and the legacy NSIS installer. Fixed UpgradeCode, MSIINSTALLPERUSER requirement, and EXE uninstaller checks.
- **Mac App Store:** Fixed MAS builds, certificate handling, and auto-locale support. Updated to Xcode 16.2.
- **CI/CD:** Reorganized GitLab CI pipeline stages, added shared runners, added translation validation CI, improved release notifications, and enabled Windows code signing failure detection.
- **Bootstrap removal:** Progressively removed `react-bootstrap` and Bootstrap CSS from modals, settings, tab bar, main page, error page, and welcome screen — replaced with native components and `floating-ui`.
- **WebContentsView migration:** Migrated from deprecated `BrowserView` to `WebContentsView`.
- **titleBarOverlay:** Migrated Windows and Linux to use `titleBarOverlay` for native title bar buttons.
- **Dependabot:** Added Dependabot for GitHub Actions dependency management.

---

## Known Issues

- Only 5 languages are supported for the Mac App Store build due to store constraints (full list of 8+ languages available on other platforms).
