#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test slides rendering without Tauri.
Starts a local HTTP server, opens slides.html in browser with test content.
"""

import http.server
import os
import socketserver
import sys
import threading
import time
import webbrowser

PORT = 8765
DIST_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Inject test content into slides.html via query param
        if self.path.startswith("/slides.html"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            html_path = os.path.join(DIST_DIR, "slides.html")
            with open(html_path, "r", encoding="utf-8") as f:
                html = f.read()
            # Inject test content before closing </head>
            test_script = """
<script>
window.__slides_content = "# Test Slide 1\\n\\nHello from automated test!\\n\\n---\\n\\n# Test Slide 2\\n\\n- Bullet A\\n- Bullet B\\n- Bullet C\\n\\n---\\n\\n# The End\\n\\nSlides are working!";
</script>
"""
            html = html.replace("</head>", test_script + "</head>")
            self.wfile.write(html.encode("utf-8"))
            return

        # Serve other files from dist directory
        super().do_GET()

def run_test():
    os.chdir(DIST_DIR)
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()

        url = f"http://localhost:{PORT}/slides.html"
        print(f"[TEST] Server running at {url}")
        print("[TEST] Opening browser...")
        webbrowser.open(url)

        print("\n[TEST] Check the browser window:")
        print("  - If you see 3 slides with headings 'Test Slide 1', 'Test Slide 2', 'The End'")
        print("  - Then slides.js and reveal.js are working correctly.")
        print("  - If still blank / white, the problem is in the frontend code.")
        print("\n[TEST] Press Ctrl+C to stop.\n")

        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            httpd.shutdown()
            print("[TEST] Server stopped.")

if __name__ == "__main__":
    run_test()
