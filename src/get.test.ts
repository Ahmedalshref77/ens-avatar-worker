import type { Address, Hex } from "viem";
import { expect, test, vi } from "vitest";
import { describe } from "../test/globals";
import { Network, ValidatedRequest } from "./chains";
import { handleGet } from "./get";
import { getOwnerAndAvailable } from "./utils";

vi.mock("./utils", () => ({
  getOwnerAndAvailable: vi.fn(),
}));

const putBucketItem = (
  bucket: R2Bucket,
  {
    name,
    owner,
    contentType = "image/jpeg",
  }: {
    name: string;
    owner?: Address;
    contentType?: string;
  }
) =>
  bucket.put(
    owner
      ? `mainnet/unregistered/${name}/${owner}`
      : `mainnet/registered/${name}`,
    new ArrayBuffer(12),
    { httpMetadata: { contentType } }
  );

const createRequest = ({
  name,
  network = "mainnet",
  ...init
}: {
  name: string;
  network?: Network;
} & RequestInit) =>
  ({
    ...new Request(`http://localhost/${network}/${name}`, init),
    name,
    network,
    chain: {} as any,
  } as ValidatedRequest);

describe("get", () => {
  test("return file", async () => {
    const request = createRequest({ name: "test" });
    const AVATAR_BUCKET = getMiniflareBindings().AVATAR_BUCKET;
    await putBucketItem(AVATAR_BUCKET, { name: "test" });

    const response = await handleGet(request, getMiniflareBindings() as any);

    expect(await response.arrayBuffer()).toEqual(new ArrayBuffer(12));
    expect(response.status).toBe(200);
  });

  test("only return content-length for head request", async () => {
    const request = createRequest({ name: "test", method: "HEAD" });
    const AVATAR_BUCKET = getMiniflareBindings().AVATAR_BUCKET;
    await putBucketItem(AVATAR_BUCKET, { name: "test" });

    const response = await handleGet(request, getMiniflareBindings() as any);

    expect(await response.arrayBuffer()).toEqual(new ArrayBuffer(0));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("12");
  });

  test("404 for not image/jpeg", async () => {
    const request = createRequest({ name: "test" });
    const AVATAR_BUCKET = getMiniflareBindings().AVATAR_BUCKET;
    await putBucketItem(AVATAR_BUCKET, {
      name: "test",
      contentType: "text/html",
    });

    const response = await handleGet(request, getMiniflareBindings() as any);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchInlineSnapshot(`
      {
        "error": "test not found on mainnet",
        "status": 404,
      }
    `);
  });

  describe("unregistered", () => {
    test("get owner when file not found", async () => {
      vi.mocked(getOwnerAndAvailable).mockResolvedValueOnce({
        owner: null,
        available: true,
      });
      const request = createRequest({ name: "test.eth" });
      await handleGet(request, getMiniflareBindings() as any);

      expect(getOwnerAndAvailable).toHaveBeenCalledWith({
        env: expect.anything(),
        chain: request.chain,
        name: request.name,
      });
    });
    test("404 when name not registered", async () => {
      vi.mocked(getOwnerAndAvailable).mockResolvedValueOnce({
        owner: null,
        available: true,
      });
      const request = createRequest({ name: "test.eth" });
      const response = await handleGet(request, getMiniflareBindings() as any);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchInlineSnapshot(`
        {
          "error": "test.eth not found on mainnet",
          "status": 404,
        }
      `);
    });
    test("404 when name is not registered - existing owned files", async () => {
      vi.mocked(getOwnerAndAvailable).mockResolvedValueOnce({
        owner: null,
        available: true,
      });
      const request = createRequest({ name: "test.eth" });
      const AVATAR_BUCKET = getMiniflareBindings().AVATAR_BUCKET;
      await putBucketItem(AVATAR_BUCKET, {
        name: "test.eth",
        owner: "0x123",
      });

      const response = await handleGet(request, getMiniflareBindings() as any);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchInlineSnapshot(`
        {
          "error": "test.eth not found on mainnet",
          "status": 404,
        }
      `);
    });
    test("404 - name is registered - no unregistered file", async () => {
      vi.mocked(getOwnerAndAvailable).mockResolvedValueOnce({
        owner: "0x123",
        available: false,
      });
      const request = createRequest({ name: "test.eth" });
      const response = await handleGet(request, getMiniflareBindings() as any);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchInlineSnapshot(`
        {
          "error": "test.eth not found on mainnet",
          "status": 404,
        }
      `);
    });
    test("404 - name is registed - no unregistered file - existing owned files", async () => {
      vi.mocked(getOwnerAndAvailable).mockResolvedValueOnce({
        owner: "0x123",
        available: false,
      });
      const request = createRequest({ name: "test.eth" });
      const AVATAR_BUCKET = getMiniflareBindings().AVATAR_BUCKET;
      await putBucketItem(AVATAR_BUCKET, {
        name: "test.eth",
        owner: "0x456",
      });

      const response = await handleGet(request, getMiniflareBindings() as any);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchInlineSnapshot(`
        {
          "error": "test.eth not found on mainnet",
          "status": 404,
        }
      `);
    });
    test("return unregistered file when found", async () => {
      vi.mocked(getOwnerAndAvailable).mockResolvedValueOnce({
        owner: "0x123",
        available: false,
      });
      const request = createRequest({ name: "test.eth" });
      const AVATAR_BUCKET = getMiniflareBindings().AVATAR_BUCKET;
      await putBucketItem(AVATAR_BUCKET, {
        name: "test.eth",
        owner: "0x123",
      });

      const response = await handleGet(request, getMiniflareBindings() as any);
      expect(response.status).toBe(200);
      expect(await response.arrayBuffer()).toEqual(new ArrayBuffer(12));
    });
    test("delete all unregistered files when name is registered", async () => {
      vi.mocked(getOwnerAndAvailable).mockResolvedValueOnce({
        owner: "0x123",
        available: false,
      });
      const request = createRequest({ name: "test.eth" });
      const AVATAR_BUCKET = getMiniflareBindings().AVATAR_BUCKET;
      const imageUploaders = Array.from(
        { length: 124 },
        (_, i) => `0x${i.toString(16)}`.padStart(42, "0") as Hex
      );
      await Promise.all(
        imageUploaders.map((uploader) =>
          putBucketItem(AVATAR_BUCKET, { name: "test.eth", owner: uploader })
        )
      );

      await handleGet(request, getMiniflareBindings() as any);

      const { objects } = await AVATAR_BUCKET.list({
        prefix: "mainnet/unregistered/test.eth",
      });
      expect(objects).toEqual([]);
    });
  });
});
