from .cufflevels import CuffLevels

__red_end_user_data_statement__ = (
    "This cog stores per-member XP totals and the timestamp of the last "
    "XP-earning message. No message content is stored."
)


async def setup(bot):
    await bot.add_cog(CuffLevels(bot))
