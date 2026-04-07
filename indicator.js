import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import GdkPixbuf from 'gi://GdkPixbuf';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {loadCache, saveCache} from './cache.js';

const POLL_INTERVAL_SECONDS = 5;

const DevialetIndicator = GObject.registerClass(
class DevialetIndicator extends PanelMenu.Button {
    _init(client, discovery, extensionPath) {
        super._init(0.0, 'Devialet Control');

        this._client = client;
        this._discovery = discovery;
        this._extensionPath = extensionPath;
        this._devices = new Map(); // name -> device object with widgets & timer
        this._destroyed = false;

        // Panel box: icon + label of playing device
        const panelBox = new St.BoxLayout({style_class: 'panel-status-indicators-box'});
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this._extensionPath}/icons/devialet.png`),
            style_class: 'system-status-icon',
        });
        panelBox.add_child(this._icon);
        this.add_child(panelBox);

        this._buildStaticMenu();
        this._loadCachedDevices();
        this._connectDiscovery();
        this._discovery.start();
    }

    // ── Static parts of the menu (header + refresh) ──────────────────────────

    _buildStaticMenu() {
        this._statusLabel = new St.Label({
            text: 'Searching for speakers...',
            style_class: 'dvlt-status-label',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        const statusItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
        statusItem.add_child(this._statusLabel);
        this.menu.addMenuItem(statusItem);
        this._statusItem = statusItem;

        // Device sections inserted dynamically here

        // Bottom bar: refresh icon button
        const bottomItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
        const bottomBox = new St.BoxLayout({x_expand: true, x_align: Clutter.ActorAlign.END});

        const refreshBtn = new St.Button({
            style_class: 'dvlt-icon-button',
            can_focus: true,
            child: new St.Icon({icon_name: 'view-refresh-symbolic', icon_size: 16}),
        });
        this._refreshBtn = refreshBtn;
        this._refreshBtnSignalId = refreshBtn.connect('clicked', () => this._onRefresh());
        bottomBox.add_child(refreshBtn);
        bottomItem.add_child(bottomBox);
        this.menu.addMenuItem(bottomItem);
        this._bottomItem = bottomItem;
    }

    // ── Per-device card ───────────────────────────────────────────────────────

    _createDeviceCard(device) {
        const section = new PopupMenu.PopupMenuSection();

        // Single reactive card item containing all content
        const cardItem = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false,
            style_class: 'dvlt-card',
        });
        device._signalIds = [];
        device._signalIds.push([cardItem, cardItem.connect('activate', () => false)]);

        const cardBox = new St.BoxLayout({vertical: true, x_expand: true});

        // ── Name + state row ──
        const headerBox = new St.BoxLayout({x_expand: true});
        device.nameLabel = new St.Label({
            text: device.displayName,
            style_class: 'dvlt-device-name',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        device.stateLabel = new St.Label({
            text: '',
            style_class: 'dvlt-device-state',
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(device.nameLabel);
        headerBox.add_child(device.stateLabel);
        cardBox.add_child(headerBox);

        // ── Controls row: [cover art] [prev] [play/pause] [next] ──
        const controlsRow = new St.BoxLayout({x_expand: true, style_class: 'dvlt-controls-row'});
        device.coverArt = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this._extensionPath}/icons/devialet-logo.png`),
            style_class: 'dvlt-cover-art',
            icon_size: 56,
        });
        const controlsBox = new St.BoxLayout({
            style_class: 'dvlt-controls-box',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        device.prevBtn = this._makeControlBtn('media-skip-backward-symbolic', () => this._onPrevious(device), device);
        device.playPauseBtn = this._makeControlBtn('media-playback-start-symbolic', () => this._onPlayPause(device), device);
        device.nextBtn = this._makeControlBtn('media-skip-forward-symbolic', () => this._onNext(device), device);
        controlsBox.add_child(device.prevBtn);
        controlsBox.add_child(device.playPauseBtn);
        controlsBox.add_child(device.nextBtn);
        controlsRow.add_child(device.coverArt);
        controlsRow.add_child(controlsBox);
        cardBox.add_child(controlsRow);

        // ── Track info (hidden when no metadata) ──
        const trackBox = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'dvlt-track-box'});
        device.titleLabel = new St.Label({text: '', style_class: 'dvlt-track-title'});
        device.artistLabel = new St.Label({text: '', style_class: 'dvlt-track-artist'});
        device.titleLabel.clutter_text.ellipsize = 3;
        device.artistLabel.clutter_text.ellipsize = 3;
        trackBox.add_child(device.titleLabel);
        trackBox.add_child(device.artistLabel);
        device.trackBox = trackBox;
        trackBox.visible = false;
        cardBox.add_child(trackBox);

        // ── Volume row ──
        const volumeBox = new St.BoxLayout({style_class: 'dvlt-volume-box', x_expand: true});
        const volIcon = new St.Icon({
            icon_name: 'audio-volume-medium-symbolic',
            style_class: 'dvlt-volume-icon',
            icon_size: 16,
        });
        device.slider = new Slider.Slider(0);
        device.slider.x_expand = true;
        device.volLabel = new St.Label({
            text: '0%',
            style_class: 'dvlt-volume-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        device._signalIds.push([device.slider, device.slider.connect('notify::value', () => {
            device.volLabel.text = `${Math.round(device.slider.value * 100)}%`;
        })]);
        device._signalIds.push([device.slider, device.slider.connect('drag-end', () => this._onVolumeChanged(device))]);
        volumeBox.add_child(volIcon);
        volumeBox.add_child(device.slider);
        volumeBox.add_child(device.volLabel);
        cardBox.add_child(volumeBox);

        cardItem.add_child(cardBox);
        section.addMenuItem(cardItem);

        // ── Separator ──
        const sep = new St.Bin({
            style: 'background-color: #888888; min-height: 1px; margin: 6px 60px;',
            x_expand: true,
        });
        section.actor.add_child(sep);

        device.section = section;
        return section;
    }

    _makeControlBtn(iconName, callback, device) {
        const btn = new St.Button({
            style_class: 'dvlt-control-button',
            can_focus: true,
            child: new St.Icon({icon_name: iconName, icon_size: 20}),
        });
        const id = btn.connect('clicked', callback);
        if (device)
            device._signalIds.push([btn, id]);
        return btn;
    }

    // ── Device lifecycle ──────────────────────────────────────────────────────

    _addDeviceToMenu(device) {
        // Insert before the bottom refresh bar
        const section = this._createDeviceCard(device);
        this.menu.addMenuItem(section, this.menu.numMenuItems - 1);
        device.section = section;
    }

    _removeDeviceFromMenu(device) {
        if (device._signalIds) {
            for (const [obj, id] of device._signalIds)
                obj.disconnect(id);
            device._signalIds = [];
        }
        if (device.section) {
            device.section.destroy();
            device.section = null;
        }
    }

    // ── Discovery ─────────────────────────────────────────────────────────────

    _connectDiscovery() {
        this._discoveryFoundId = this._discovery.connect('device-found',
            (_d, name, address, port, model) => this._onDeviceFound(name, address, port, model));
        this._discoveryLostId = this._discovery.connect('device-lost',
            (_d, name) => this._onDeviceLost(name));
    }

    _onDeviceFound(name, host, port, model) {
        if (this._devices.has(name))
            return;

        const displayName = name || model || host;
        const device = {name, host, port: String(port), model, displayName, state: null, pollTimerId: null};
        this._devices.set(name, device);

        console.debug(`[dvlt-ctrl] Found: ${displayName} (${model}) at ${host}:${port}`);

        this._addDeviceToMenu(device);
        this._updateStatusLabel();
        this._saveDevicesToCache();

        this._pollDevice(device);
        this._startPolling(device);
    }

    _onDeviceLost(name) {
        const device = this._devices.get(name);
        if (!device)
            return;

        this._stopPolling(device);
        this._removeDeviceFromMenu(device);
        this._devices.delete(name);
        this._updateStatusLabel();
    }

    // ── Polling ───────────────────────────────────────────────────────────────

    _startPolling(device) {
        this._stopPolling(device);
        device.pollTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_SECONDS, () => {
            if (this._destroyed)
                return GLib.SOURCE_REMOVE;
            this._pollDevice(device);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling(device) {
        if (device.pollTimerId) {
            GLib.source_remove(device.pollTimerId);
            device.pollTimerId = null;
        }
    }

    async _pollDevice(device) {
        if (this._destroyed)
            return;
        const [state, volume] = await Promise.all([
            this._client.getPlaybackState(device.host, device.port),
            this._client.getVolume(device.host, device.port),
        ]);
        if (this._destroyed)
            return;

        if (state) {
            device.state = state;
            this._updateDeviceUI(device, state, volume);
        }
    }

    // ── UI updates ────────────────────────────────────────────────────────────

    _updateDeviceUI(device, state, volume) {
        if (!device.stateLabel)
            return;

        // State text
        const sourceLabel = this._formatSourceType(state.sourceType);
        let stateText = '';
        if (state.playing)
            stateText = sourceLabel ? `Playing (${sourceLabel})` : 'Playing';
        else if (state.state === 'paused')
            stateText = sourceLabel ? `Paused (${sourceLabel})` : 'Paused';
        else if (state.state && state.state !== 'unknown')
            stateText = state.state.charAt(0).toUpperCase() + state.state.slice(1);
        if (state.muted)
            stateText += stateText ? ' · Muted' : 'Muted';
        device.stateLabel.text = stateText;

        // Play/pause icon
        device.playPauseBtn.child.icon_name = state.playing
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';

        // Volume
        if (volume !== null) {
            device.slider.value = volume / 100;
            device.volLabel.text = `${volume}%`;
        }

        // Now playing metadata
        const hasTrack = !!(state.title || state.artist);
        device.trackBox.visible = hasTrack;

        if (hasTrack) {
            device.titleLabel.text = state.title || '';
            device.artistLabel.text = state.artist || '';
        }

        // Cover art: load if URL available, otherwise reset to logo
        const coverUrl = hasTrack ? state.coverArtUrl : '';
        if (coverUrl && coverUrl !== device._lastCoverUrl) {
            device._lastCoverUrl = coverUrl;
            this._loadCoverArt(device, coverUrl);
        } else if (!coverUrl && device._lastCoverUrl) {
            device._lastCoverUrl = '';
            device.coverArt.gicon = Gio.icon_new_for_string(`${this._extensionPath}/icons/devialet-logo.png`);
        }
    }

    _loadCoverArt(device, url) {
        try {
            const session = this._client.session;
            const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
            const msg = new Soup.Message({method: 'GET', uri});
            session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (_s, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (msg.get_status() !== Soup.Status.OK)
                        return;
                    const gBytes = GLib.Bytes.new(bytes.get_data());
                    const stream = Gio.MemoryInputStream.new_from_bytes(gBytes);
                    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_at_scale(stream, 48, 48, true, null);
                    device.coverArt.gicon = pixbuf;
                } catch (_e) {}
            });
        } catch (_e) {}
    }

    _formatSourceType(sourceType) {
        const map = {
            'spotifyconnect': 'Spotify',
            'airplay2': 'AirPlay',
            'airplay': 'AirPlay',
            'bluetooth': 'Bluetooth',
            'optical': 'Optical',
            'line': 'Line-in',
            'hdmi': 'HDMI',
            'roonready': 'Roon',
            'upnp': 'UPnP',
        };
        return map[sourceType] || sourceType || '';
    }

    _updateStatusLabel() {
        const count = this._devices.size;
        this._statusItem.visible = count === 0;
        if (count === 0)
            this._statusLabel.text = 'No speakers found';
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    async _onPlayPause(device) {
        const state = await this._client.getPlaybackState(device.host, device.port);
        if (state && state.playing)
            await this._client.pause(device.host, device.port);
        else
            await this._client.play(device.host, device.port);
        this._pollDevice(device);
    }

    async _onPrevious(device) {
        await this._client.previous(device.host, device.port);
        this._pollDevice(device);
    }

    async _onNext(device) {
        await this._client.next(device.host, device.port);
        this._pollDevice(device);
    }

    async _onVolumeChanged(device) {
        const volume = Math.round(device.slider.value * 100);
        await this._client.setVolume(device.host, device.port, volume);
    }

    get devices() {
        return this._devices;
    }

    pollAllDevices() {
        for (const device of this._devices.values())
            this._pollDevice(device);
    }

    _onRefresh() {
        // Background scan: don't clear the UI.
        // New devices will be added, unreachable ones are removed by _verifyCachedDevices.
        this._verifyCachedDevices();
        this._discovery.stop();
        this._discovery.start();
    }

    // ── Cache ─────────────────────────────────────────────────────────────────

    async _loadCachedDevices() {
        const cached = await loadCache();
        for (const d of cached) {
            if (!d.name || !d.host || !d.port)
                continue;
            console.debug(`[dvlt-ctrl] Loading cached device: ${d.displayName || d.name}`);
            const device = {name: d.name, host: d.host, port: d.port, model: d.model, displayName: d.displayName, state: null, pollTimerId: null};
            this._devices.set(d.name, device);
            this._addDeviceToMenu(device);
            this._pollDevice(device);
            this._startPolling(device);
        }
        this._updateStatusLabel();
        if (this._devices.size > 0)
            this._verifyCachedDevices();
    }

    async _verifyCachedDevices() {
        for (const [name, device] of this._devices) {
            // A quick playback state fetch is enough to confirm reachability
            const state = await this._client.getPlaybackState(device.host, device.port);
            if (!state) {
                console.debug(`[dvlt-ctrl] Cached device unreachable: ${name}`);
                this._stopPolling(device);
                this._removeDeviceFromMenu(device);
                this._devices.delete(name);
                this._updateStatusLabel();
            }
        }
        this._saveDevicesToCache();
    }

    _saveDevicesToCache() {
        const devices = [];
        for (const d of this._devices.values())
            devices.push({name: d.name, host: d.host, port: d.port, model: d.model, displayName: d.displayName});
        saveCache(devices);
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    destroy() {
        this._destroyed = true;
        for (const device of this._devices.values()) {
            this._stopPolling(device);
            if (device._signalIds) {
                for (const [obj, id] of device._signalIds)
                    obj.disconnect(id);
                device._signalIds = [];
            }
        }

        if (this._refreshBtnSignalId) {
            this._refreshBtn.disconnect(this._refreshBtnSignalId);
            this._refreshBtnSignalId = null;
        }

        if (this._discoveryFoundId) {
            this._discovery.disconnect(this._discoveryFoundId);
            this._discoveryFoundId = null;
        }
        if (this._discoveryLostId) {
            this._discovery.disconnect(this._discoveryLostId);
            this._discoveryLostId = null;
        }
        super.destroy();
    }
});

export default DevialetIndicator;
