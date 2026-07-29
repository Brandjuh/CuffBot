from .cuffstarboard import CuffStarboard


async def setup(bot):
    await bot.add_cog(CuffStarboard(bot))
