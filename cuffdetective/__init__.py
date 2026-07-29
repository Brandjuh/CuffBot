from .cuffdetective import CuffDetective

__red_end_user_data_statement__ = (
    "This cog keeps a short-lived, in-memory conversation history per channel "
    "(30 minutes) to give the AI context. Nothing is persisted to disk."
)


async def setup(bot):
    await bot.add_cog(CuffDetective(bot))
