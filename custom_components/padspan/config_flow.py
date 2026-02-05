from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import (
    DOMAIN,
    CONF_ENTRY_NAME,
    CONF_SCANNING_MODE,
    CONF_MANUFACTURER_ID,
    DEFAULT_NAME,
    DEFAULT_SCANNING_MODE,
)

SCANNING_MODE_CHOICES = ["active", "passive"]


class PadSpanConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if user_input is None:
            schema = vol.Schema(
                {
                    vol.Optional(CONF_ENTRY_NAME, default=DEFAULT_NAME): str,
                    vol.Optional(CONF_SCANNING_MODE, default=DEFAULT_SCANNING_MODE): vol.In(SCANNING_MODE_CHOICES),
                    vol.Optional(CONF_MANUFACTURER_ID): vol.Coerce(int),
                }
            )
            return self.async_show_form(step_id="user", data_schema=schema)

        name = user_input.get(CONF_ENTRY_NAME, DEFAULT_NAME)
        return self.async_create_entry(title=name, data=user_input)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return PadSpanOptionsFlow(config_entry)


class PadSpanOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry):
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        if user_input is None:
            current = self.config_entry.data
            options = self.config_entry.options
            schema = vol.Schema(
                {
                    vol.Optional(
                        CONF_SCANNING_MODE,
                        default=options.get(CONF_SCANNING_MODE, current.get(CONF_SCANNING_MODE, DEFAULT_SCANNING_MODE)),
                    ): vol.In(SCANNING_MODE_CHOICES),
                    vol.Optional(
                        CONF_MANUFACTURER_ID,
                        default=options.get(CONF_MANUFACTURER_ID, current.get(CONF_MANUFACTURER_ID, "")),
                    ): vol.Any("", vol.Coerce(int)),
                }
            )
            return self.async_show_form(step_id="init", data_schema=schema)

        cleaned = dict(user_input)
        if cleaned.get(CONF_MANUFACTURER_ID, "") == "":
            cleaned.pop(CONF_MANUFACTURER_ID, None)
        return self.async_create_entry(title="", data=cleaned)
