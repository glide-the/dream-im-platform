// [Input] Current-user picture range or exact-date read requested by Dream.
// [Output] Two strict OAuth read contracts with stable picture/time projections.
// [Pos] Registry103 picture-history boundary; actor and physical selectors never cross the wire.
// [Sync] 2026-09-15: preserve inclusive history filters, nullable metadata and full-image absence.
import { z } from "zod";
import { friendPictureDto } from "./socialFriendshipDto";

export const pictureHistoryDateDto = z.iso.date();
export const pictureHistoryItemDto = friendPictureDto;
export const pictureHistoryListInputDto = z.strictObject({
  start_date: pictureHistoryDateDto.nullable(),
  end_date: pictureHistoryDateDto.nullable(),
  limit: z.number().int().nonnegative().safe(),
});
export const pictureHistoryFullInputDto = z.strictObject({ date: pictureHistoryDateDto });

export const pictureHistoryOperationContracts = {
  "picture-history.list": {
    kind: "read" as const,
    userScope: "dream:read",
    input: pictureHistoryListInputDto,
    output: z.strictObject({ pictures: z.array(pictureHistoryItemDto) }),
  },
  "picture-history.full": {
    kind: "read" as const,
    userScope: "dream:read",
    input: pictureHistoryFullInputDto,
    output: z.strictObject({ image_base64: z.string().nullable() }),
  },
};

export type PictureHistoryListInput = z.infer<typeof pictureHistoryListInputDto>;
export type PictureHistoryOperation = keyof typeof pictureHistoryOperationContracts;
