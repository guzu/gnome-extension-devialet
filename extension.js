import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import DevialetClient from './devialetClient.js';
import AvahiDiscovery from './avahiDiscovery.js';
import DevialetIndicator from './indicator.js';

export default class DevialetControlExtension extends Extension {
    enable() {
        this._client = new DevialetClient();
        this._discovery = new AvahiDiscovery();
        this._indicator = new DevialetIndicator(this._client, this._discovery, this.path);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._discovery.destroy();
        this._discovery = null;

        this._indicator.destroy();
        this._indicator = null;

        this._client.destroy();
        this._client = null;
    }
}
