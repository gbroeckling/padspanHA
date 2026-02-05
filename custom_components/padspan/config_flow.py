from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback

from .const import (
    DOMAIN,
    CONF_SESSION_DURATION_S,
    DEFAULT_SESSION_DURATION_S,
)


class PadSpanConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(
                title="PadSpan",
                data=user_input,
            )

        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_SESSION_DURATION_S,
                    default=DEFAULT_SESSION_DURATION_S,
                ): vol.All(vol.Coerce(int), vol.Range(min=10, max=3600)),
            }
        )

        return self.async_show_form(step_id="user", data_schema=schema)

    @callback
    def async_get_options_flow(self, config_entry):
        return PadSpanOptionsFlow(config_entry)


class PadSpanOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry):
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_SESSION_DURATION_S,
                    default=self.config_entry.options.get(
                        CONF_SESSION_DURATION_S,
                        self.config_entry.data.get(CONF_SESSION_DURATION_S, DEFAULT_SESSION_DURATION_S),
                    ),
                ): vol.All(vol.Coerce(int), vol.Range(min=10, max=3600)),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
