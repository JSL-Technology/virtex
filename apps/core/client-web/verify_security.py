from playwright.sync_api import sync_playwright

def verify_security_settings():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to My Profile page (assuming auth bypass or login)
        # Since we can't easily login in this environment without backend running and seeded,
        # we might struggle to see the actual authenticated view.
        # However, we can try to navigate to /dashboard/settings/my-profile.
        # If redirect to login, we see login.

        try:
            # We need to wait for the server to be up.
            # In a real scenario, we'd wait for localhost:4200
            page.goto("http://localhost:4200/dashboard/settings/my-profile")

            # Since we are likely redirected to login, we might not see the new component.
            # To verify the component VISUALLY, we might need to mock the state or just check if it builds.
            # But the instructions say "Visually Inspect Your Work".
            # If I cannot login, I cannot verify the "My Profile" page.

            # Mocking strategy:
            # We can use route interception to mock the user response and auth status to force 'logged in' state.

            page.route("**/api/v1/auth/status", lambda route: route.fulfill(
                status=200,
                body='{"isAuthenticated":true,"user":{"id":"1","email":"test@test.com","firstName":"Test","lastName":"User","isTwoFactorEnabled":false}}'
            ))

            page.route("**/api/v1/users/profile", lambda route: route.fulfill(
                status=200,
                body='{"id":"1","email":"test@test.com","firstName":"Test","lastName":"User"}'
            ))

             # Mock sessions
            page.route("**/api/v1/auth/sessions", lambda route: route.fulfill(
                status=200,
                body='[{"id":"s1","ipAddress":"127.0.0.1","userAgent":"Chrome/Test","createdAt":"2023-01-01T00:00:00Z","isCurrent":true}]'
            ))

            page.goto("http://localhost:4200/dashboard/settings/my-profile")

            # Wait for component
            page.wait_for_selector("app-security-settings", timeout=10000)

            # Screenshot
            page.screenshot(path="/home/jules/verification/verification.png")

        except Exception as e:
            print(f"Error: {e}")
            # Take screenshot anyway to see where we are
            page.screenshot(path="/home/jules/verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_security_settings()
