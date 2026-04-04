import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const CACHE_DIR = GLib.get_user_cache_dir();
const CACHE_FILE = GLib.build_filenamev([CACHE_DIR, 'dvlt-ctrl-gnome']);

/**
 * Load cached devices list.
 * Returns array of {name, host, port, model, displayName} or empty array.
 */
export function loadCache() {
    try {
        const file = Gio.File.new_for_path(CACHE_FILE);
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            return [];
        const text = new TextDecoder().decode(contents);
        const data = JSON.parse(text);
        if (Array.isArray(data))
            return data;
    } catch (_e) {}
    return [];
}

/**
 * Save devices list to cache.
 * @param {Array} devices - array of {name, host, port, model, displayName}
 */
export function saveCache(devices) {
    try {
        const dir = Gio.File.new_for_path(CACHE_DIR);
        if (!dir.query_exists(null))
            dir.make_directory_with_parents(null);

        const file = Gio.File.new_for_path(CACHE_FILE);
        const json = JSON.stringify(devices, null, 2);
        file.replace_contents(
            new TextEncoder().encode(json),
            null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null
        );
    } catch (e) {
        console.error(`[dvlt-ctrl] Failed to save cache: ${e.message}`);
    }
}
