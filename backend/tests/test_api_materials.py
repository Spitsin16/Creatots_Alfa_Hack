import json
import re
from pathlib import Path

from app.main import app


ROOT = Path(__file__).resolve().parents[2]
HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


def _path_shape(path: str) -> str:
    path = path.split("?", 1)[0]
    path = re.sub(r"\{\{[^}/]+}}", "{}", path)
    return re.sub(r"\{[^}/]+}", "{}", path)


def test_static_openapi_matches_application() -> None:
    committed = json.loads((ROOT / "docs/openapi.json").read_text(encoding="utf-8"))

    assert committed == app.openapi()


def test_postman_requests_match_openapi_routes() -> None:
    schema = app.openapi()
    routes = {
        (method.upper(), _path_shape(path))
        for path, operations in schema["paths"].items()
        for method in operations
        if method.upper() in HTTP_METHODS
    }
    collection = json.loads(
        (ROOT / "docs/postman/Smart_Credit_Cabinet.postman_collection.json").read_text(encoding="utf-8")
    )
    requests = [item for folder in collection["item"] for item in folder["item"]]
    unmatched = []
    for item in requests:
        method = item["request"]["method"]
        url = item["request"]["url"]
        if url == "{{baseUrl}}/openapi.json":
            continue
        path = url.removeprefix("{{baseUrl}}")
        if (method, _path_shape(path)) not in routes:
            unmatched.append((method, path))

    assert unmatched == []
