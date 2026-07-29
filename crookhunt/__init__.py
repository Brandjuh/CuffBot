from .crookhunt import CrookHunt

__red_end_user_data_statement__ = (
    "This cog stores per-member crook-catch statistics (totals per crook type). "
    "No message content is stored."
)


async def setup(bot):
    await bot.add_cog(CrookHunt(bot))
