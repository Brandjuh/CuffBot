from .cuffsolo import CuffSolo


async def setup(bot):
    await bot.add_cog(CuffSolo(bot))
