"""Screenshot the fixture harness page. Usage: python tools/shots_harness.py <port> <outdir>"""
import sys
from playwright.sync_api import sync_playwright

port, outdir = sys.argv[1:3]

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1780, "height": 1100}, device_scale_factor=2)
    page.goto(f"http://localhost:{port}/ifc-harness.html?v=h", wait_until="domcontentloaded")
    page.wait_for_selector("[data-testid='interface-track']", timeout=30000)
    page.wait_for_timeout(3000)
    # full page, then crops
    page.screenshot(path=f"{outdir}/harness-full.png", full_page=True)
    track = page.locator("[data-testid='interface-track']")
    track.scroll_into_view_if_needed(); page.wait_for_timeout(500)
    track.screenshot(path=f"{outdir}/harness-track.png")
    tiers = page.locator("[data-testid='partner-tiers']")
    tiers.scroll_into_view_if_needed(); page.wait_for_timeout(500)
    tiers.screenshot(path=f"{outdir}/harness-tiers.png")
    # bounding boxes for measurement
    for name, sel in [("track", "[data-testid='interface-track']"), ("tiers", "[data-testid='partner-tiers']"),
                      ("head", ".ifc-partners__head"), ("tier1", ".ifc-tier"), ("search", ".ifc-search--toggle, .ifc-search")]:
        el = page.locator(sel).first
        if el.count():
            print(name, el.bounding_box())
    browser.close()
print("done")
