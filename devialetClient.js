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
    mute: '/groups/current/sources/current/playback/mute',
    unmute: '/groups/current/sources/current/playback/unmute',
    nightMode: '/systems/current/settings/audio/nightMode',
};

export default class DevialetClient {
    constructor() {
        this._session = new Soup.Session({timeout: 2});
    }

    get session() {
        return this._session;
    }

    _buildUri(host, port, endpoint) {
        return GLib.Uri.parse(`http://${host}:${port}${API_PREFIX}${endpoint}`, GLib.UriFlags.NONE);
    }

    /**
     * Send an async HTTP request, returns parsed JSON or null.
     */
    _request(method, host, port, endpoint, body = null) {
        return new Promise((resolve) => {
            const uri = this._buildUri(host, port, endpoint);
            const msg = new Soup.Message({method, uri});

            if (body) {
                const bytes = GLib.Bytes.new(new TextEncoder().encode(JSON.stringify(body)));
                msg.set_request_body_from_bytes('application/json', bytes);
            }

            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (msg.get_status() !== Soup.Status.OK) {
                        resolve(null);
                        return;
                    }
                    const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    resolve(data.error ? null : data);
                } catch (_e) {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Get current volume (0-100) or null
     */
    async getVolume(host, port) {
        const data = await this._request('GET', host, port, ENDPOINTS.volume);
        return data && 'volume' in data ? data.volume : null;
    }

    async setVolume(host, port, volume) {
        const clamped = Math.max(0, Math.min(100, Math.round(volume)));
        return (await this._request('POST', host, port, ENDPOINTS.volume, {volume: clamped})) !== null;
    }

    async getPlaybackState(host, port) {
        const data = await this._request('GET', host, port, ENDPOINTS.playbackState);
        if (!data)
            return null;
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

    async play(host, port) {
        return (await this._request('POST', host, port, ENDPOINTS.play)) !== null;
    }

    async pause(host, port) {
        return (await this._request('POST', host, port, ENDPOINTS.pause)) !== null;
    }

    async next(host, port) {
        return (await this._request('POST', host, port, ENDPOINTS.next)) !== null;
    }

    async previous(host, port) {
        return (await this._request('POST', host, port, ENDPOINTS.previous)) !== null;
    }

    async mute(host, port) {
        return (await this._request('POST', host, port, ENDPOINTS.mute)) !== null;
    }

    async unmute(host, port) {
        return (await this._request('POST', host, port, ENDPOINTS.unmute)) !== null;
    }

    async getNightMode(host, port) {
        const data = await this._request('GET', host, port, ENDPOINTS.nightMode);
        return data ? data.nightMode === 'on' : null;
    }

    async setNightMode(host, port, enabled) {
        return (await this._request('POST', host, port, ENDPOINTS.nightMode, {nightMode: enabled ? 'on' : 'off'})) !== null;
    }

    destroy() {
        this._session = null;
    }
}
