"""Stands in for the `city` cog: a module whose package name is on the
allow-list, sending straight to a channel with no Context involved."""

import discord


async def announce(destination, text):
    return await discord.abc.Messageable.send(destination, text)
