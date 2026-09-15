"""Bounded HTTPS downloads shared by host and standalone desktop installation."""
import urllib.parse,urllib.request

class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise ValueError("Update redirect must use HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def fetch(url: str, maximum: int) -> bytes:
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("Updates require HTTPS")
    request = urllib.request.Request(url, headers={"User-Agent": "jaunt updater", "Cache-Control": "no-cache"})
    with urllib.request.build_opener(HTTPSRedirect()).open(request, timeout=30) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError("Update artifact exceeds its size limit")
    return data

