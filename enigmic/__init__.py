"""Enigmic - an original murder-mystery deduction puzzle cog for Red-DiscordBot.

The cog class is imported lazily inside :func:`setup` so that the pure game
logic modules (models, solver, validator, ...) can be imported and unit
tested without redbot or discord installed.
"""


async def setup(bot):
    """Load the Enigmic cog into Red."""
    from .enigmic import Enigmic

    await bot.add_cog(Enigmic(bot))
