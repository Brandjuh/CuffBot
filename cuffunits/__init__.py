from .cuffunits import CuffUnits


async def setup(bot):
    await bot.add_cog(CuffUnits(bot))
