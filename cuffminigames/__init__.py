from .cuffminigames import CuffMinigames

__red_end_user_data_statement__ = (
    "This cog stores per-guild game settings only. Games live in memory and are "
    "discarded when the bot restarts; no user data is stored."
)


async def setup(bot):
    await bot.add_cog(CuffMinigames(bot))
