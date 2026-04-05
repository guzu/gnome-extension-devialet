import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import DevialetClient from './devialetClient.js';
import AvahiDiscovery from './avahiDiscovery.js';
import DevialetIndicator from './indicator.js';

const VOLUME_STEP = 5;

export default class DevialetControlExtension extends Extension {
    enable() {
        this._client = new DevialetClient();
        this._discovery = new AvahiDiscovery();
        this._indicator = new DevialetIndicator(this._client, this._discovery, this.path);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._settings = this.getSettings();
        Main.wm.addKeybinding('volume-up', this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._adjustVolume(VOLUME_STEP));
        Main.wm.addKeybinding('volume-down', this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._adjustVolume(-VOLUME_STEP));
    }

    async _adjustVolume(delta) {
        const playing = [...this._indicator.devices.values()]
            .filter(d => d.state && d.state.playing);
        if (playing.length !== 1)
            return;

        const device = playing[0];
        const vol = await this._client.getVolume(device.host, device.port);
        if (vol !== null) {
            const newVol = Math.max(0, Math.min(100, vol + delta));
            await this._client.setVolume(device.host, device.port, newVol);
        }
        this._indicator.pollAllDevices();
    }

    disable() {
        Main.wm.removeKeybinding('volume-up');
        Main.wm.removeKeybinding('volume-down');
        this._settings = null;

        this._discovery.destroy();
        this._discovery = null;

        this._indicator.destroy();
        this._indicator = null;

        this._client.destroy();
        this._client = null;
    }
}
