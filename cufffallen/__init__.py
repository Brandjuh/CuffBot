from .cufffallen import CuffFallen


async def setup(bot):
    await bot.add_cog(CuffFallen(bot))
