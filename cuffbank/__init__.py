from .cuffbank import CuffBank


async def setup(bot):
    await bot.add_cog(CuffBank(bot))
