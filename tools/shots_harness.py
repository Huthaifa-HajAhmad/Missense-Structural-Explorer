"""Screenshot the fixture harness page (both fixtures). Usage: python tools/shots_harness.py <port> <outdir>"""
import sys
from playwright.sync_api import sync_playwright

port, outdir = sys.argv[1:3]

with sync_playwright() as p:
    browser = p.chromium.launch()
    for tag, suffix in [("", ""), ("?bare=1", "-bare")]:
        page = browser.new_page(viewport={"width": 1780, "height": 1100}, device_scale_factor=2)
        page.goto(f"http://localhost:{port}/ifc-harness.html{tag}", wait_until="domcontentloaded")
        page.wait_for_selector("[data-testid='interface-track']", timeout=30000)
        page.wait_for_timeout(2500)
        track = page.locator("[data-testid='interface-track']")
        track.scroll_into_view_if_needed(); page.wait_for_timeout(500)
        track.screenshot(path=f"{outdir}/harness-track{suffix}.png")
        tiers = page.locator(".ifc-partners__head")
        tiers.scroll_into_view_if_needed(); page.wait_for_timeout(500)
        tiers.screenshot(path=f"{outdir}/harness-head{suffix}.png")
        page.close()
    browser.close()
print("done")
