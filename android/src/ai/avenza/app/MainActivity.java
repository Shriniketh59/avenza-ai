package ai.avenza.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * AVENZA AI for Android: the web app full screen, with the camera, microphone, file uploads and downloads it uses.
 *
 * It loads the AVENZA server running on the computer. Over USB that is http://localhost:3000 after
 * `adb reverse tcp:3000 tcp:3000` (localhost counts as a secure page, so the camera and microphone work);
 * over the internet it is the https tunnel link. When the server cannot be reached, a setup page asks for the address.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "avenza";
    private static final String KEY_URL = "server_url";
    private static final String DEFAULT_URL = "http://localhost:3000";
    private static final String SETUP_PAGE = "file:///android_asset/setup.html";
    private static final int REQ_PERMISSIONS = 1;
    private static final int REQ_FILES = 2;

    private WebView web;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> pendingFiles;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF070F24);
        web = new WebView(this);
        root.addView(web);
        setContentView(root);
        applyInsets(root);
        configure();
        if (state != null) web.restoreState(state);
        else web.loadUrl(serverUrl());
    }

    /** Keep the page clear of the status bar, navigation bar and keyboard (Android 15 draws edge to edge). */
    private void applyInsets(View root) {
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return insets;
        });
    }

    private void configure() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // spoken replies play as they arrive
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " AVENZA-Android/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "Avenza");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                Uri server = Uri.parse(serverUrl());
                String scheme = uri.getScheme();
                if (("http".equals(scheme) || "https".equals(scheme)) && sameOrigin(uri, server)) return false;
                // Other sites (sources, GitHub, mail links) open in the phone's browser or app.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this, "No app can open this link.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame() || request.getUrl().toString().startsWith("file:")) return;
                showSetup("Could not reach " + request.getUrl().getHost() + " (" + error.getDescription() + ").");
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> askPermissions(request));
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                Intent intent = params.createIntent();
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(intent, REQ_FILES);
                } catch (ActivityNotFoundException e) {
                    pendingFiles = null;
                    return false;
                }
                return true;
            }
        });

        // Generated PDF / Word files and images: saved to Downloads with the signed-in session's cookies.
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            if (!url.startsWith("http")) {
                Toast.makeText(this, "This export works in the browser version only.", Toast.LENGTH_LONG).show();
                return;
            }
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url))
                    .setMimeType(mimeType)
                    .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
                    .addRequestHeader("User-Agent", userAgent)
                    .setTitle(name)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(req);
            Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
        });
    }

    private static boolean sameOrigin(Uri a, Uri b) {
        return a.getHost() != null && a.getHost().equalsIgnoreCase(b.getHost()) && a.getPort() == b.getPort();
    }

    private String serverUrl() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, DEFAULT_URL);
    }

    private void showSetup(String error) {
        web.loadUrl(SETUP_PAGE + "?url=" + Uri.encode(serverUrl()) + "&error=" + Uri.encode(error == null ? "" : error));
    }

    /** Camera and microphone for the page: ask Android first if the app does not have them yet. */
    private void askPermissions(PermissionRequest request) {
        List<String> needed = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) needed.add(Manifest.permission.CAMERA);
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) needed.add(Manifest.permission.RECORD_AUDIO);
        }
        List<String> missing = new ArrayList<>();
        for (String p : needed) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        if (missing.isEmpty()) {
            request.grant(request.getResources());
            return;
        }
        if (pendingPermission != null) pendingPermission.deny();
        pendingPermission = request;
        requestPermissions(missing.toArray(new String[0]), REQ_PERMISSIONS);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code != REQ_PERMISSIONS || pendingPermission == null) return;
        List<String> grant = new ArrayList<>();
        for (String r : pendingPermission.getResources()) {
            String p = PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) ? Manifest.permission.CAMERA
                    : PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) ? Manifest.permission.RECORD_AUDIO : null;
            if (p != null && checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) grant.add(r);
        }
        if (grant.isEmpty()) {
            pendingPermission.deny();
            Toast.makeText(this, "Allow the camera and microphone for AVENZA in the phone's Settings.", Toast.LENGTH_LONG).show();
        } else {
            pendingPermission.grant(grant.toArray(new String[0]));
        }
        pendingPermission = null;
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILES || pendingFiles == null) return;
        Uri[] uris = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                uris = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < uris.length; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                uris = new Uri[]{data.getData()};
            }
        }
        pendingFiles.onReceiveValue(uris);
        pendingFiles = null;
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("AVENZA AI")
                .setItems(new CharSequence[]{"Change server address", "Reload", "Exit"}, (d, which) -> {
                    if (which == 0) showSetup("");
                    else if (which == 1) web.loadUrl(serverUrl());
                    else finish();
                })
                .show();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush(); // stay signed in after the app is closed
    }

    /** Called from the setup page only. */
    private class Bridge {
        @JavascriptInterface
        public void connect(String url) {
            runOnUiThread(() -> {
                if (!web.getUrl().startsWith(SETUP_PAGE)) return; // the AVENZA site itself cannot change the server
                if (!url.startsWith("http://") && !url.startsWith("https://")) return;
                SharedPreferences.Editor e = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
                e.putString(KEY_URL, url).apply();
                web.clearHistory();
                web.loadUrl(url);
            });
        }
    }
}
