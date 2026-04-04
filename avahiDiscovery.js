import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

const AVAHI_BUS_NAME = 'org.freedesktop.Avahi';
const AVAHI_SERVER_PATH = '/';
const AVAHI_SERVER_IFACE = 'org.freedesktop.Avahi.Server';
const AVAHI_SERVICE_BROWSER_IFACE = 'org.freedesktop.Avahi.ServiceBrowser';
const AVAHI_SERVICE_RESOLVER_IFACE = 'org.freedesktop.Avahi.ServiceResolver';

const AVAHI_IF_UNSPEC = -1;
const AVAHI_PROTO_INET = 0;  // IPv4 only
const RESCAN_INTERVAL_SECONDS = 10;

/**
 * mDNS discovery via Avahi D-Bus interface.
 * Emits 'device-found' and 'device-lost' signals.
 * Re-scans periodically to catch devices that failed initial resolution.
 */
const AvahiDiscovery = GObject.registerClass({
    Signals: {
        'device-found': {param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_UINT, GObject.TYPE_STRING]},
        'device-lost': {param_types: [GObject.TYPE_STRING]},
    },
}, class AvahiDiscovery extends GObject.Object {
    _init() {
        super._init();
        this._bus = null;
        this._browserPath = null;
        this._subscriptionIds = [];
        this._resolverPaths = [];
        this._running = false;
        this._rescanTimerId = null;
        this._resolvedNames = new Set();
    }

    start() {
        if (this._running)
            return;

        this._running = true;

        try {
            this._bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
        } catch (e) {
            log(`[dvlt-ctrl] Failed to connect to system bus: ${e.message}`);
            return;
        }

        this._startBrowser();
        this._startRescanTimer();
    }

    _startBrowser() {
        this._stopBrowser();
        this._resolvedNames.clear();

        try {
            const result = this._bus.call_sync(
                AVAHI_BUS_NAME,
                AVAHI_SERVER_PATH,
                AVAHI_SERVER_IFACE,
                'ServiceBrowserNew',
                new GLib.Variant('(iissu)', [AVAHI_IF_UNSPEC, AVAHI_PROTO_INET, '_devialet-http._tcp', '', 0]),
                new GLib.VariantType('(o)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );

            this._browserPath = result.get_child_value(0).get_string()[0];
        } catch (e) {
            log(`[dvlt-ctrl] Failed to create Avahi ServiceBrowser: ${e.message}`);
            return;
        }

        // Subscribe to ItemNew signal
        const newId = this._bus.signal_subscribe(
            AVAHI_BUS_NAME,
            AVAHI_SERVICE_BROWSER_IFACE,
            'ItemNew',
            this._browserPath,
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                this._onItemNew(params);
            }
        );
        this._subscriptionIds.push(newId);

        // Subscribe to ItemRemove signal
        const removeId = this._bus.signal_subscribe(
            AVAHI_BUS_NAME,
            AVAHI_SERVICE_BROWSER_IFACE,
            'ItemRemove',
            this._browserPath,
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                this._onItemRemove(params);
            }
        );
        this._subscriptionIds.push(removeId);
    }

    _startRescanTimer() {
        this._stopRescanTimer();
        this._rescanTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RESCAN_INTERVAL_SECONDS, () => {
            if (!this._running)
                return GLib.SOURCE_REMOVE;
            log(`[dvlt-ctrl] Periodic re-scan`);
            this._startBrowser();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopRescanTimer() {
        if (this._rescanTimerId) {
            GLib.source_remove(this._rescanTimerId);
            this._rescanTimerId = null;
        }
    }

    _onItemNew(params) {
        const iface = params.get_child_value(0).get_int32();
        const protocol = params.get_child_value(1).get_int32();
        const name = params.get_child_value(2).get_string()[0];
        const type = params.get_child_value(3).get_string()[0];
        const domain = params.get_child_value(4).get_string()[0];

        // Skip if already resolved in this scan cycle
        if (this._resolvedNames.has(name))
            return;

        log(`[dvlt-ctrl] ItemNew: "${name}" iface=${iface} proto=${protocol}`);

        try {
            const result = this._bus.call_sync(
                AVAHI_BUS_NAME,
                AVAHI_SERVER_PATH,
                AVAHI_SERVER_IFACE,
                'ServiceResolverNew',
                new GLib.Variant('(iisssiu)', [iface, protocol, name, type, domain, AVAHI_PROTO_INET, 0]),
                new GLib.VariantType('(o)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );

            const resolverPath = result.get_child_value(0).get_string()[0];
            this._resolverPaths.push(resolverPath);

            // Subscribe to Found signal
            const foundId = this._bus.signal_subscribe(
                AVAHI_BUS_NAME,
                AVAHI_SERVICE_RESOLVER_IFACE,
                'Found',
                resolverPath,
                null,
                Gio.DBusSignalFlags.NONE,
                (_conn, _sender, _path, _iface, _signal, foundParams) => {
                    this._onServiceFound(foundParams);
                }
            );
            this._subscriptionIds.push(foundId);

            // Subscribe to Failure signal
            const failId = this._bus.signal_subscribe(
                AVAHI_BUS_NAME,
                AVAHI_SERVICE_RESOLVER_IFACE,
                'Failure',
                resolverPath,
                null,
                Gio.DBusSignalFlags.NONE,
                (_conn, _sender, _path, _iface, _signal, failParams) => {
                    const error = failParams.get_child_value(0).get_string()[0];
                    log(`[dvlt-ctrl] Resolver failed for a service: ${error}`);
                }
            );
            this._subscriptionIds.push(failId);
        } catch (e) {
            log(`[dvlt-ctrl] Failed to resolve service "${name}": ${e.message}`);
        }
    }

    _onServiceFound(params) {
        const name = params.get_child_value(2).get_string()[0];
        const address = params.get_child_value(7).get_string()[0];
        const port = params.get_child_value(8).get_uint16();

        // Parse TXT records (aay) to extract model
        let model = '';
        try {
            const txtArray = params.get_child_value(9);
            for (let i = 0; i < txtArray.n_children(); i++) {
                const entry = txtArray.get_child_value(i);
                // ay variant: iterate bytes manually
                const len = entry.n_children();
                const chars = [];
                for (let j = 0; j < len; j++)
                    chars.push(entry.get_child_value(j).get_byte());
                const str = String.fromCharCode(...chars);
                if (str.startsWith('model='))
                    model = str.slice(6);
            }
        } catch (_e) {}

        this._resolvedNames.add(name);
        log(`[dvlt-ctrl] Avahi resolved: ${name} (${model}) -> ${address}:${port}`);
        this.emit('device-found', name, address, port, model);
    }

    _onItemRemove(params) {
        const name = params.get_child_value(2).get_string()[0];
        this._resolvedNames.delete(name);
        this.emit('device-lost', name);
    }

    _stopBrowser() {
        // Unsubscribe all signals
        if (this._bus) {
            for (const id of this._subscriptionIds)
                this._bus.signal_unsubscribe(id);
        }
        this._subscriptionIds = [];

        // Free resolvers
        if (this._bus) {
            for (const path of this._resolverPaths) {
                try {
                    this._bus.call_sync(
                        AVAHI_BUS_NAME, path, AVAHI_SERVICE_RESOLVER_IFACE,
                        'Free', null, null, Gio.DBusCallFlags.NONE, -1, null
                    );
                } catch (_e) {}
            }
        }
        this._resolverPaths = [];

        // Free browser
        if (this._bus && this._browserPath) {
            try {
                this._bus.call_sync(
                    AVAHI_BUS_NAME, this._browserPath, AVAHI_SERVICE_BROWSER_IFACE,
                    'Free', null, null, Gio.DBusCallFlags.NONE, -1, null
                );
            } catch (_e) {}
        }
        this._browserPath = null;
    }

    stop() {
        if (!this._running)
            return;

        this._running = false;
        this._stopRescanTimer();
        this._stopBrowser();
        this._bus = null;
    }

    destroy() {
        this.stop();
    }
});

export default AvahiDiscovery;
