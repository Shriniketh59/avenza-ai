import os

from avenza import create_app

app = create_app()

if __name__ == "__main__":
    # Bound to localhost only: the browser reaches it through Next.js on :3000.
    app.run(host="127.0.0.1", port=int(os.environ.get("BACKEND_PORT", "5000")), debug=os.environ.get("FLASK_DEBUG") == "1")
