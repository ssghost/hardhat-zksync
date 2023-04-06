import {
    getStorageLayout,
    getUnlinkedBytecode,
    getVersion,
    StorageLayout,
    UpgradesError,
    ValidationDataCurrent,
    Version,
} from '@openzeppelin/upgrades-core';

import ethers from 'ethers';
import * as zk from 'zksync-web3';
import { FormatTypes } from 'ethers/lib/utils';
import type { HardhatRuntimeEnvironment } from 'hardhat/types';

import { DeployProxyOptions, GetTxResponse, UpgradeOptions, withDefaults } from '../utils/options';
import { validateBeaconImpl, validateProxyImpl } from '../validations/validate-impl';
import { readValidations } from '../validations/validations';

import { deploy } from './deploy';
import { fetchOrDeployGetDeployment } from '../core/impl-store';

export interface DeployData {
    provider: zk.Provider;
    validations: ValidationDataCurrent;
    unlinkedBytecode: string;
    encodedArgs: string;
    version: Version;
    layout: StorageLayout;
    fullOpts: Required<UpgradeOptions>;
}

export async function getDeployData(
    hre: HardhatRuntimeEnvironment,
    contractFactory: zk.ContractFactory,
    opts: UpgradeOptions
): Promise<DeployData> {
    const provider = opts.provider;
    const validations = await readValidations(hre);
    const unlinkedBytecode = contractFactory.bytecode;
    const encodedArgs = contractFactory.interface.encodeDeploy(opts.constructorArgs);
    const version = getVersion(unlinkedBytecode, contractFactory.bytecode, encodedArgs);
    const layout = getStorageLayout(validations, version);
    const fullOpts = withDefaults(opts);
    return { provider, validations, unlinkedBytecode, encodedArgs, version, layout, fullOpts };
}

export async function deployProxyImpl(
    hre: HardhatRuntimeEnvironment,
    contractFactory: zk.ContractFactory,
    opts: DeployProxyOptions,
    proxyAddress?: string
): Promise<any> {
    const deployData = await getDeployData(hre, contractFactory, opts);
    await validateProxyImpl(deployData, opts, proxyAddress);
    return await deployImpl(hre, deployData, contractFactory, opts);
}

async function deployImpl(
    hre: HardhatRuntimeEnvironment,
    deployData: DeployData,
    factory: zk.ContractFactory,
    opts: UpgradeOptions & GetTxResponse
): Promise<any> {
    const layout = deployData.layout;

    const deployment = await fetchOrDeployGetDeployment(
        deployData.version,
        deployData.provider,
        async () => {
            const abi = factory.interface.format(FormatTypes.minimal) as string[];
            const attemptDeploy = async () => {
                if (opts.useDeployedImplementation) {
                    throw new UpgradesError(
                        'The implementation contract was not previously deployed.',
                        () =>
                            'The useDeployedImplementation option was set to true but the implementation contract was not previously deployed on this network.'
                    );
                } else {
                    const deployed = await deploy(factory, deployData.fullOpts.constructorArgs);

                    return deployed;
                }
            };
            const deployment = Object.assign({ abi }, await attemptDeploy());
            return { ...deployment, layout };
        },
        opts
    );

    let txResponse;
    if (opts.getTxResponse) {
        // This code is used to support the legacy API, where the txResponse is returned
        if ('deployTransaction' in deployment) {
            txResponse = deployment.deployTransaction;
        } else if (deployment.txHash !== undefined) {
            txResponse = hre.ethers.provider.getTransaction(deployment.txHash);
        }
    }

    return { impl: deployment.address, kind: opts.kind, txResponse };
}

interface DeployedBeaconImpl {
    impl: string;
    txResponse?: ethers.providers.TransactionResponse;
}

export async function deployBeaconImpl(
    hre: HardhatRuntimeEnvironment,
    factory: zk.ContractFactory,
    opts: UpgradeOptions,
    beaconAddress?: string
): Promise<DeployedBeaconImpl> {
    const deployData = await getDeployData(hre, factory, opts);
    await validateBeaconImpl(deployData, opts, beaconAddress);
    return await deployImpl(hre, deployData, factory, opts);
}
