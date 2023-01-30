import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import {
  generateBlobSASQueryParameters,
  ContainerSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";

const sharedKeyCredential = new StorageSharedKeyCredential(
  process.env["AZURE_STORAGE_NAME"],
  process.env["AZURE_STORAGE_KEY"]
);
const STORAGE_BASE_URL = `https://${process.env["AZURE_STORAGE_NAME"]}.blob.core.windows.net`;
const CONTAINER_NAME = "songs";

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  const blobServiceClient = new BlobServiceClient(
    STORAGE_BASE_URL,
    sharedKeyCredential
  );

  const songsContainer = blobServiceClient.getContainerClient(CONTAINER_NAME);
  const songList = [];
  for await (const blob of songsContainer.listBlobsFlat()) {
    songList.push(blob.name);
  }

  const SAS = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      permissions: ContainerSASPermissions.parse("racwdl"),
      expiresOn: new Date(new Date().valueOf() + 86400),
    },
    sharedKeyCredential
  );
  const sasUri = `${STORAGE_BASE_URL}/?${SAS.toString()}`;

  context.res = {
    body: {
      songs: songList,
      baseStorageUrl: STORAGE_BASE_URL + '/' + CONTAINER_NAME,
      sasUri
    },
  };
};

export default httpTrigger;
