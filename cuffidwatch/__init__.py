from .cuffidwatch import CuffIdWatch

__red_end_user_data_statement__ = (
    "This cog stores per-user notification preferences (ping on/off, DM "
    "on/off). No message content is stored."
)


async def setup(bot):
    await bot.add_cog(CuffIdWatch(bot))
