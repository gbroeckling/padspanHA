"""Serve the repo for the harness on 127.0.0.1:8765 (or PADSPAN_HARNESS_PORT, or the port given).

    python tools/live_aboard_harness/serve.py [port]

The same as `python -m http.server 8765 --bind 127.0.0.1` from the repo root,
except that /favicon.ico answers 204, so the only 404s in a check's console
are real ones (issue #95).
"""

import functools
import http.server
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PADSPAN_HARNESS_PORT", "8765"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?", 1)[0] == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, *args):  # quiet: the checks print what matters
        pass


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Serving {ROOT} on http://127.0.0.1:{PORT}", flush=True)
        httpd.serve_forever()
