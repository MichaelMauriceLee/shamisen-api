import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import {
  BlobServiceClient,
  ContainerSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
import { CosmosClient } from "@azure/cosmos";
import * as jsmediatags from "jsmediatags";
import { v4 as uuidv4 } from "uuid";

const sharedKeyCredential = new StorageSharedKeyCredential(
  process.env["STORAGE_NAME"],
  process.env["STORAGE_KEY"]
);
const STORAGE_BASE_URL = `https://${process.env["STORAGE_NAME"]}.blob.core.windows.net`;
const SONG_CONTAINER_NAME = "songs";
const COVER_CONTAINER_NAME = "covers";
const DATABASE_NAME = "shamisen";
const PARTITION_KEY = "/partitionKey";

const blobServiceClient = new BlobServiceClient(
  STORAGE_BASE_URL,
  sharedKeyCredential
);
const cosmosClient = new CosmosClient(
  process.env["COSMOS_DB_CONNECTION_STRING"]
);

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  switch (req.method) {
    case "GET": {
      await getSongs(context);
      break;
    }
    case "POST": {
      await addSong(context, req);
      break;
    }
  }
};

async function getSongs(context: Context) {
  const { database } = await cosmosClient.databases.createIfNotExists({
    id: DATABASE_NAME,
  });
  const { container } = await database.containers.createIfNotExists({
    id: DATABASE_NAME,
    partitionKey: {
      paths: [PARTITION_KEY],
    },
  });

  const fetchAllSongsQuery = await container.items.readAll({
    partitionKey: "1",
  });
  const queryResponse = await fetchAllSongsQuery.fetchAll();
  const songList = queryResponse.resources;

  const SAS = generateBlobSASQueryParameters(
    {
      containerName: SONG_CONTAINER_NAME,
      permissions: ContainerSASPermissions.parse("racwdl"),
      expiresOn: new Date(new Date().valueOf() + 86400),
    },
    sharedKeyCredential
  );
  const sasUri = `${STORAGE_BASE_URL}/?${SAS.toString()}`;

  context.res = {
    headers: {
      "content-type": "application/json",
    },
    body: {
      songs: songList,
      sasUri,
    },
  };
}

async function addSong(context: Context, req: HttpRequest) {
  jsmediatags.read(req.bufferBody, {
    onSuccess: async (metadata) => {
      const {
        type,
        tags: {
          title,
          artist,
          album,
          picture: { data, format },
        },
      } = metadata;

      //TODO check if type is an audio file

      const trackId = uuidv4();

      const coversContainer =
        blobServiceClient.getContainerClient(COVER_CONTAINER_NAME);
      const songsContainer =
        blobServiceClient.getContainerClient(SONG_CONTAINER_NAME);
      const blobContainer = coversContainer.getBlockBlobClient(trackId);
      const songBlobContainer = songsContainer.getBlockBlobClient(trackId);

      await blobContainer.uploadData(Buffer.from(data), {
        blobHTTPHeaders: { blobContentType: format },
      });
      await songBlobContainer.uploadData(req.bufferBody, {
        blobHTTPHeaders: { blobContentType: type },
      });

      const { database } = await cosmosClient.databases.createIfNotExists({
        id: DATABASE_NAME,
      });
      const { container } = await database.containers.createIfNotExists({
        id: DATABASE_NAME,
        partitionKey: {
          paths: [PARTITION_KEY],
        },
      });
      const item = {
        id: trackId,
        url: `${STORAGE_BASE_URL}/${SONG_CONTAINER_NAME}/${trackId}`,
        title,
        artist,
        album,
        artwork: `${STORAGE_BASE_URL}/${COVER_CONTAINER_NAME}/${trackId}`,
        partitionKey: "1",
      };
      await container.items.create(item);
      context.res = {
        headers: {
          "content-type": "application/json",
        },
        body: item,
      };
    },
    onError: (error) => {
      console.log(":(", error.type, error.info);
    },
  });
}

export default httpTrigger;
