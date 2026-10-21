package in.rungnna.shopos;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.security.MessageDigest;
import org.json.JSONArray;
import org.json.JSONObject;

/* Automatic updates for the Android app, without reinstalling.

   The live site publishes app-build.json (every file of the current release + SHA-256).
   check(): downloads a newer release into <files>/web-updates/<id>, verifying every file.
   apply(): switches the app to it (the screens reload once). started(): the new screens
   report they opened fine. If a release fails to start twice, MainActivity puts the app
   back on the last good one (see Watchdog). */
@CapacitorPlugin(name = "RjUpdate")
public class RjUpdatePlugin extends Plugin {
    static final String PREFS = "RjUpdate";
    // Capacitor's own setting for where the screens are served from
    static final String CAP_PREFS = "CapWebViewSettings", CAP_PATH = "serverBasePath";
    static final int SHELL_API = 1;
    private volatile boolean busy = false;

    static File root(Context c) { return new File(c.getFilesDir(), "web-updates"); }

    @PluginMethod
    public void info(PluginCall call) {
        SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSObject o = new JSObject();
        o.put("active", p.getString("active", "bundled"));
        o.put("ready", p.getString("pending", ""));
        o.put("shell", SHELL_API);
        call.resolve(o);
    }

    @PluginMethod
    public void check(PluginCall call) {
        final String origin = call.getString("origin", "https://rungnnashopos.vercel.app");
        if (busy) { call.resolve(new JSObject()); return; }
        busy = true;
        new Thread(() -> {
            try {
                Context c = getContext();
                SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                JSONObject m = new JSONObject(new String(get(origin + "/app-build.json?t=" + System.currentTimeMillis()), "UTF-8"));
                String id = m.optString("id", "");
                JSObject out = new JSObject();
                String active = p.getString("active", "bundled"), pending = p.getString("pending", "");
                if (id.isEmpty() || id.equals(active) || id.equals(pending) || p.getString("bad", "").contains("," + id + ",")
                        || m.optInt("minShell", 1) > SHELL_API || !id.matches("[0-9a-f]{8,64}")) {
                    out.put("ready", pending); call.resolve(out); return;
                }
                File dir = new File(root(c), id), tmp = new File(root(c), id + ".partial");
                delete(tmp);
                JSONArray files = m.getJSONArray("files");
                File activeDir = active.equals("bundled") ? null : new File(root(c), active);
                for (int i = 0; i < files.length(); i++) {
                    JSONObject f = files.getJSONObject(i);
                    String rel = f.getString("path"), sum = f.getString("sha256");
                    if (rel.contains("..") || !rel.matches("[\\w./@-]+")) throw new Exception("bad path " + rel);
                    byte[] bytes = null;
                    // unchanged files come from what is already on the phone
                    try {
                        byte[] have = activeDir != null ? read(new FileInputStream(new File(activeDir, rel))) : read(c.getAssets().open("public/" + rel));
                        if (sha(have).equals(sum)) bytes = have;
                    } catch (Exception ignored) { }
                    if (bytes == null) {
                        StringBuilder u = new StringBuilder(origin);
                        for (String part : rel.split("/")) u.append('/').append(URLEncoder.encode(part, "UTF-8").replace("+", "%20"));
                        bytes = get(u.append("?b=").append(id).toString());
                        if (!sha(bytes).equals(sum)) throw new Exception("checksum " + rel);
                    }
                    File dest = new File(tmp, rel);
                    dest.getParentFile().mkdirs();
                    try (FileOutputStream o = new FileOutputStream(dest)) { o.write(bytes); }
                }
                try (FileOutputStream o = new FileOutputStream(new File(tmp, "app-build.json"))) { o.write(m.toString().getBytes("UTF-8")); }
                delete(dir);
                if (!tmp.renameTo(dir)) throw new Exception("could not finish the update folder");
                p.edit().putString("pending", id).apply();
                out.put("ready", id);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("Update check failed: " + e.getMessage());
            } finally { busy = false; }
        }).start();
    }

    @PluginMethod
    public void apply(PluginCall call) {
        Context c = getContext();
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = p.getString("pending", "");
        File dir = new File(root(c), id);
        if (id.isEmpty() || !new File(dir, "index.html").exists()) { call.resolve(new JSObject().put("applied", false)); return; }
        String active = p.getString("active", "bundled");
        p.edit().putString("good", p.getBoolean("trial", false) ? p.getString("good", "bundled") : active)
            .putString("active", id).putString("pending", "").putBoolean("trial", true).putInt("starts", 0).commit();
        c.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE).edit().putString(CAP_PATH, dir.getAbsolutePath()).commit();
        call.resolve(new JSObject().put("applied", true));
        getActivity().runOnUiThread(() -> getBridge().setServerBasePath(dir.getAbsolutePath()));
    }

    @PluginMethod
    public void started(PluginCall call) {
        Context c = getContext();
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (p.getBoolean("trial", false)) {
            String active = p.getString("active", "bundled");
            p.edit().putBoolean("trial", false).putInt("starts", 0).putString("good", active).commit();
            // keep only the running release, the last good one and a ready one
            File[] all = root(c).listFiles();
            if (all != null) for (File f : all) {
                String n = f.getName();
                if (!n.equals(active) && !n.equals(p.getString("pending", ""))) delete(f);
            }
        }
        call.resolve(new JSObject());
    }

    /* Called from MainActivity before the screens load: roll back a release that never started. */
    static void watchdog(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("trial", false)) return;
        int starts = p.getInt("starts", 0);
        if (starts < 2) { p.edit().putInt("starts", starts + 1).commit(); return; }
        String bad = p.getString("active", ""), good = p.getString("good", "bundled");
        File goodDir = new File(root(c), good);
        SharedPreferences.Editor cap = c.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE).edit();
        if (!good.equals("bundled") && new File(goodDir, "index.html").exists()) cap.putString(CAP_PATH, goodDir.getAbsolutePath());
        else { cap.remove(CAP_PATH); good = "bundled"; }
        cap.commit();
        p.edit().putString("active", good).putBoolean("trial", false).putInt("starts", 0)
            .putString("bad", p.getString("bad", ",") + bad + ",").commit();
    }

    private static byte[] get(String url) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(15000); h.setReadTimeout(60000); h.setUseCaches(false);
        try {
            if (h.getResponseCode() != 200) throw new Exception(url + " " + h.getResponseCode());
            return read(h.getInputStream());
        } finally { h.disconnect(); }
    }
    private static byte[] read(InputStream in) throws Exception {
        try (InputStream i = in; ByteArrayOutputStream o = new ByteArrayOutputStream()) {
            byte[] b = new byte[16384]; int n;
            while ((n = i.read(b)) > 0) o.write(b, 0, n);
            return o.toByteArray();
        }
    }
    private static String sha(byte[] b) throws Exception {
        StringBuilder s = new StringBuilder();
        for (byte x : MessageDigest.getInstance("SHA-256").digest(b)) s.append(String.format("%02x", x));
        return s.toString();
    }
    private static void delete(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) delete(k);
        f.delete();
    }
}
