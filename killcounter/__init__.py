from .killcounter import KillCounter


async def setup(bot):
    await bot.add_cog(KillCounter(bot))
