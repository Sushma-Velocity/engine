/* eslint-disable dot-location */
/** Copyright (c) 2023, Poozle, all rights reserved. **/

// This file generates the base64 string for the credentials stored
import * as fs from 'fs';
import { resolve } from 'path';

import axios from 'axios';
import * as yaml from 'js-yaml';

import { PrismaClient } from './client';

const prisma = new PrismaClient();

async function testSource(endpoint: string, config: string) {
  try {
    const response = await axios.post(
      endpoint,
      {
        query: '{getSpec{spec}}',
      },
      {
        headers: {
          config,
        },
      },
    );

    return response.status === 200;
  } catch (e) {
    return false;
  }
}

async function main(): Promise<null> {
  // Don't let this through if WORKSPACE_ID is not found in the process
  if (!process.env.WORKSPACE_ID) {
    return null;
  }

  // Fetch all the extension accounts for this workspace
  const allExtensionAccountsForWorkspace =
    await prisma.extensionAccount.findMany({
      where: {
        workspaceId: process.env.WORKSPACE_ID,
      },
    });

  /*
    Loop through all the accounts and generate a base64 with the
    configuration saved
  */
  const sources = await Promise.all(
    allExtensionAccountsForWorkspace
      .map(async (account) => {
        const configHeaders = Buffer.from(
          JSON.stringify(account.extensionConfiguration),
        ).toString('base64');
        const accountName = account.name.replace(/ /g, '_');

        const extensionRouter = await prisma.extensionRouter.findUnique({
          where: {
            extensionDefinitionId: account.extensionDefinitionId,
          },
        });

        const endpoint = extensionRouter.endpoint;
        const testStatus = await testSource(endpoint, configHeaders);

        if (!testStatus) {
          return undefined;
        }

        return {
          name: account.extensionAccountName,
          handler: {
            graphql: {
              // TODO (harshith): Remove static URL and move this to ExtensionRouter based
              endpoint,
              operationHeaders: {
                config: configHeaders,
              },
            },
          },
          transforms: [
            {
              /* 
                This plugin is used so that we can merge the types and roots when same extension is configured
                multiple times.
              */
              prefix: {
                mode: 'wrap',
                value: `${accountName}_`,
              },
            },
            {
              /* 
                This is used so that we can write queries easily when multiple accounts are configured
                for the same Extension
                query {
                  github_1 {

                  }
                  github_2 {

                  }
                }
              */
              encapsulate: {
                name: account.extensionAccountName,
                applyTo: {
                  query: true,
                  mutation: true,
                  subscription: true,
                },
              },
            },
          ],
        };
      })
      .filter(Boolean),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meshConfig: any = {
    sources,
    // TODO (harshith): remove this playground configuration from here
    serve: {
      playground: true,
    },
  };

  // Write the yaml to meshrc which is used to create the server
  fs.writeFileSync(
    resolve('.meshrc.yml'),
    yaml.dump(meshConfig, {
      sortKeys: true,
      noRefs: true,
      lineWidth: -1,
    }),
  );

  return null;
}

main();
