from playwright.sync_api import sync_playwright
import os

def run_cuj(page):
    print("Navigating to login page...")
    page.goto("http://localhost:4200/es/login")

    # Wait for the app to bootstrap
    page.wait_for_timeout(5000)

    print(f"Current URL: {page.url}")

    # Try to find something on the page
    try:
        page.wait_for_selector("input", timeout=10000)
        print("Found input")
    except:
        print("Still no inputs found")
        page.screenshot(path="/home/jules/verification/screenshots/fail_debug_v3.png")
        return

    # Initial state
    page.screenshot(path="/home/jules/verification/screenshots/login_final_es.png")
    print("Saved login_final_es.png")

    # Show focus
    page.focus('input[type="email"]')
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/screenshots/login_focus_es.png")

    # Trigger error
    page.click('button[type="submit"]')
    page.wait_for_timeout(1000)
    page.screenshot(path="/home/jules/verification/screenshots/login_error_es.png")
    print("Saved error screenshot")

if __name__ == "__main__":
    os.makedirs("/home/jules/verification/videos", exist_ok=True)
    os.makedirs("/home/jules/verification/screenshots", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()
