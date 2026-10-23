import { env } from "~/env";
import { Prisma, PrismaClient } from "~/generated/prisma";

const createPrismaClient = () =>
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
  prismaSchema: string | undefined;
  prismaConstructor: typeof PrismaClient | undefined;
};

const schema = JSON.stringify(Prisma.dmmf.datamodel);
export const db =
  globalForPrisma.prismaSchema === schema &&
  globalForPrisma.prismaConstructor === PrismaClient &&
  globalForPrisma.prisma
    ? globalForPrisma.prisma
    : createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaSchema = schema;
  globalForPrisma.prismaConstructor = PrismaClient;
}
