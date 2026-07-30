from .cuffselfroles import CuffSelfRoles


async def setup(bot):
    await bot.add_cog(CuffSelfRoles(bot))
