import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { StakingProgram } from "../target/types/staking_program";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import idl from "../target/idl/staking_program.json";

type StakeInfo = {
  stakeAtSlot: anchor.BN;
  isStaked: boolean;
};

describe("staking_program", () => {
  // Configure the client to use the devnet cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = provider.wallet as anchor.Wallet;
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );
  const mintKeypair = Keypair.fromSecretKey(
    new Uint8Array([
      43, 27, 151, 45, 139, 219, 146, 72, 2, 135, 178, 1, 18, 167, 207, 104,
      188, 195, 223, 215, 53, 92, 130, 89, 17, 129, 86, 32, 74, 177, 37, 102,
      62, 24, 88, 63, 173, 77, 110, 83, 81, 153, 65, 25, 186, 129, 118, 10, 62,
      252, 190, 154, 124, 218, 196, 231, 246, 112, 208, 183, 150, 229, 236, 173,
    ])
  );

  // const program = anchor.workspace.StakingProgram as Program<StakingProgram>;

  const program = new anchor.Program(
    idl as anchor.Idl,
    "Dthxpk9KWQ2BDGLhV6G1Seq4dUbGNiDZ5omvgmNMTi4p", // Deployed program ID
    provider
  );

  async function ensureMintInitialized() {
    const mintInfo = await connection.getAccountInfo(mintKeypair.publicKey);

    if (!mintInfo) {
      console.log("Mint does not exist. Creating mint...");
      const mint = await createMint(
        connection,
        payer.payer,
        payer.publicKey, // Mint authority
        payer.publicKey, // Freeze authority
        9, // Decimals
        mintKeypair // Mint keypair
      );
      console.log(mint);
      console.log("Mint initialized:", mintKeypair.publicKey.toBase58());
    } else {
      console.log("Mint already exists:", mintKeypair.publicKey.toBase58());
    }
  }

  // async function createMintToken() {
  //   const mint = await createMint(
  //     connection,
  //     payer.payer,
  //     payer.publicKey,
  //     payer.publicKey,
  //     9,
  //     mintKeypair
  //   );
  //   console.log(mint);
  // }

  before(async () => {
    await ensureMintInitialized();
  });

  it("Is initialized (should give error)!", async () => {
    // await createMintToken();

    let [vaultAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId
    );

    try {
      const tx = await program.methods
        .initialize()
        .accounts({
          signer: payer.publicKey,
          tokenVaultAccount: vaultAccount,
          mint: mintKeypair.publicKey,
        })
        .rpc();

      console.log("initialized (unexpected success):", tx);
    } catch (err) {
      console.log("Expected error (already initialized):", err.message);
    }
  });

  it("stake!", async () => {
    let userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer.payer,
      mintKeypair.publicKey,
      payer.publicKey
    );

    // await mintTo(
    //   connection,
    //   payer.payer,
    //   mintKeypair.publicKey,
    //   userTokenAccount.address,
    //   payer.payer,
    //   1e11
    // );

    let [stakeInfo] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_info"), payer.publicKey.toBuffer()],
      program.programId
    );

    let [stakeAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("token"), payer.publicKey.toBuffer()],
      program.programId
    );

    await getOrCreateAssociatedTokenAccount(
      connection,
      payer.payer,
      mintKeypair.publicKey,
      payer.publicKey
    );

    // Ensure no tokens are staked before running the test
    try {
      const stakeInfoAcc = await program.account.stakeInfoAccount.fetch(
        stakeInfo
      );
      if (stakeInfoAcc.isStaked) {
        console.log("Tokens are already staked. Skipping test.");
        return;
      }
    } catch (err) {
      console.log("Stake info account does not exist. Proceeding to stake.");
    }

    const tx = await program.methods
      .stake(new anchor.BN(2))
      .signers([payer.payer])
      .accounts({
        stakeInfoAccount: stakeInfo,
        stakeAccount: stakeAccount,
        userTokenAccount: userTokenAccount.address,
        mint: mintKeypair.publicKey,
        signer: payer.publicKey,
      })
      .rpc();

    console.log("tx", tx);
  });

  it("log time left to unstake", async function () {
    const lockPeriod = 250; // Adjust lock period to match your program
    const slotDurationInSeconds = 0.43; // Approximate slot time on Solana devnet

    // Fetch the current slot
    const currentSlot = await connection.getSlot();
    console.log("Current slot:", currentSlot);

    // Find the stakeInfo account
    let [stakeInfo] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_info"), payer.publicKey.toBuffer()],
      program.programId
    );

    // Fetch the stakeInfo account
    const stakeInfoAcc = (await program.account.stakeInfo.fetch(
      stakeInfo
    )) as StakeInfo;

    console.log("Stake started at slot:", stakeInfoAcc.stakeAtSlot.toNumber());

    // Calculate remaining slots
    const slotsPassed = currentSlot - stakeInfoAcc.stakeAtSlot.toNumber();
    const slotsLeft = lockPeriod - slotsPassed;

    if (slotsLeft > 0) {
      const timeLeftInSeconds = slotsLeft * slotDurationInSeconds;
      console.log(
        `Time left to unstake: ${timeLeftInSeconds.toFixed(2)} seconds`
      );
    } else {
      console.log("Lock period has expired. You can unstake now.");
    }
  });

  // it("attempts to unstake before lock period expires (should fail)", async function () {
  //   let userTokenAccount = await getOrCreateAssociatedTokenAccount(
  //     connection,
  //     payer.payer,
  //     mintKeypair.publicKey,
  //     payer.publicKey
  //   );

  //   let [stakeInfo] = PublicKey.findProgramAddressSync(
  //     [Buffer.from("stake_info"), payer.publicKey.toBuffer()],
  //     program.programId
  //   );

  //   let [stakeAccount] = PublicKey.findProgramAddressSync(
  //     [Buffer.from("token"), payer.publicKey.toBuffer()],
  //     program.programId
  //   );

  //   let [vaultAccount] = PublicKey.findProgramAddressSync(
  //     [Buffer.from("vault")],
  //     program.programId
  //   );

  //   console.log("Attempting to unstake before lock period expires...");

  //   try {
  //     const tx = await program.methods
  //       .unstake()
  //       .signers([payer.payer])
  //       .accounts({
  //         stakeAccount: stakeAccount,
  //         stakeInfoAccount: stakeInfo,
  //         userTokenAccount: userTokenAccount.address,
  //         tokenVaultAccount: vaultAccount,
  //         mint: mintKeypair.publicKey,
  //         signer: payer.publicKey,
  //       })
  //       .rpc();

  //     console.log("Unstake tx (unexpected success):", tx);
  //   } catch (err) {
  //     console.log("Expected error (lock period not met):", err.message);
  //   }
  // });

  it("unstakes successfully after lock period expires", async function () {
    let userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer.payer,
      mintKeypair.publicKey,
      payer.publicKey
    );

    let [stakeInfo] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_info"), payer.publicKey.toBuffer()],
      program.programId
    );

    let [stakeAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("token"), payer.publicKey.toBuffer()],
      program.programId
    );

    let [vaultAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId
    );

    console.log("Waiting for lock period to expire...");

    // Wait for the lock period (adjust based on your program's slot duration)
    await new Promise((resolve) => setTimeout(resolve, 110_000)); // Adjust time as needed

    const tx = await program.methods
      .unstake()
      .signers([payer.payer])
      .accounts({
        stakeAccount: stakeAccount,
        stakeInfoAccount: stakeInfo,
        userTokenAccount: userTokenAccount.address,
        tokenVaultAccount: vaultAccount,
        mint: mintKeypair.publicKey,
        signer: payer.publicKey,
      })
      .rpc();

    console.log("Unstake tx:", tx);
  });
});
