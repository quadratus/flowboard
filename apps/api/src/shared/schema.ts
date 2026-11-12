import { Type } from "@fastify/type-provider-typebox";

export const Id = Type.String({ format: "uuid" });
export const IdParams = Type.Object({ id: Id });
export const AnchorProps = {
  afterId: Type.Optional(Id),
  beforeId: Type.Optional(Id),
};
