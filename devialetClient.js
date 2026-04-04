import Soup from 'gi://Soup?version=3.0';
import GLib from 'gi://GLib';

const API_PREFIX = '/ipcontrol/v1';

const ENDPOINTS = {
    volume: '/systems/current/sources/current/soundControl/volume',
    playbackState: '/groups/current/sources/current',
    play: '/groups/current/sources/current/playback/play',
    pause: '/groups/current/sources/current/playback/pause',
    next: '/groups/current/sources/current/playback/next',
    previous: '/groups/current/sources/current/playback/previous',
    device: '/devices/current',
};

export default class DevialetClient {
    constructor() {
        this._session = new Soup.Session({timeout: 2});
    }

    _buildUri(host, port, endpoint) {
        return GLib.Uri.parse(`http://${host}:${port}${API_PREFIX}${endpoint}`, GLib.UriFlags.NONE);
    }

    /**
     * Async GET request, returns parsed JSON or null
     */
    _getAsync(host, port, endpoint) {
        return new Promise((resolve) => {
            const uri = this._buildUri(host, port, endpoint);
            const msg = new Soup.Message({method: 'GET', uri});

            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (msg.get_status() !== Soup.Status.OK) {
                        resolve(null);
                        return;
                    }
                    const text = new TextDecoder().decode(bytes.get_data());
                    const data = JSON.parse(text);
                    if (data.error) {
                        resolve(null);
                        return;
                    }
                    resolve(data);
                } catch (_e) {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Async POST request, returns parsed JSON or null
     */
    _postAsync(host, port, endpoint, body = null) {
        return new Promise((resolve) => {
            const uri = this._buildUri(host, port, endpoint);
            const msg = new Soup.Message({method: 'POST', uri});

            const jsonStr = body ? JSON.stringify(body) : '{}';
            const bytes = GLib.Bytes.new(new TextEncoder().encode(jsonStr));
            msg.set_request_body_from_bytes('application/json', bytes);

            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const respBytes = session.send_and_read_finish(result);
                    if (msg.get_status() !== Soup.Status.OK) {
                        resolve(null);
                        return;
                    }
                    const text = new TextDecoder().decode(respBytes.get_data());
                    const data = JSON.parse(text);
                    if (data.error) {
                        resolve(null);
                        return;
                    }
                    resolve(data);
                } catch (_e) {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Verify a device is Devialet by checking /devices/current
     * Returns device info {deviceId, model, ...} or null
     */
    async verifyDevice(host, port) {
        const data = await this._getAsync(host, port, ENDPOINTS.device);
        if (data && data.deviceId && data.model)
            return data;
        return null;
    }

    /**
     * Get current volume (0-100) or null
     */
    async getVolume(host, port) {
        const data = await this._getAsync(host, port, ENDPOINTS.volume);
        if (data && 'volume' in data)
            return data.volume;
        return null;
    }

    /**
     * Set volume (0-100), returns true on success
     */
    async setVolume(host, port, volume) {
        const clamped = Math.max(0, Math.min(100, Math.round(volume)));
        const data = await this._postAsync(host, port, ENDPOINTS.volume, {volume: clamped});
        return data !== null;
    }

    /**
     * Get playback state
     * Returns {playing, state, muted, title, artist, album, coverArtUrl} or null
     */
    async getPlaybackState(host, port) {
        const data = await this._getAsync(host, port, ENDPOINTS.playbackState);
        if (data) {
            const meta = data.metadata || {};
            const src = data.source || {};
            return {
                playing: data.playingState === 'playing',
                state: data.playingState || 'unknown',
                muted: data.muteState === 'muted',
                sourceType: src.type || '',
                title: meta.title || '',
                artist: meta.artist || '',
                album: meta.album || '',
                coverArtUrl: meta.coverArtUrl || '',
            };
        }
        return null;
    }

    async play(host, port) {
        return (await this._postAsync(host, port, ENDPOINTS.play)) !== null;
    }

    async pause(host, port) {
        return (await this._postAsync(host, port, ENDPOINTS.pause)) !== null;
    }

    async next(host, port) {
        return (await this._postAsync(host, port, ENDPOINTS.next)) !== null;
    }

    async previous(host, port) {
        return (await this._postAsync(host, port, ENDPOINTS.previous)) !== null;
    }

    destroy() {
        this._session = null;
    }
}
