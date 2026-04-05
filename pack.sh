#!/bin/sh

gnome-extensions pack . \
    --extra-source=devialetClient.js \
    --extra-source=avahiDiscovery.js \
    --extra-source=indicator.js \
    --extra-source=cache.js \
    --extra-source=icons/devialet.png \
    --extra-source=icons/devialet-logo.png

