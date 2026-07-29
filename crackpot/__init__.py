from .crackpot import CrackPot

__red_end_user_data_statement__ = (
    "This cog stores per-member steal cooldown timestamps and daily pot-crack "
    "attempt dates. No message content is stored."
)


async def setup(bot):
    await bot.add_cog(CrackPot(bot))
