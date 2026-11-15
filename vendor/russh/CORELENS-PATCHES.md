# russh 0.65.1, as Corelens carries it

The crate as published on crates.io (Apache-2.0, LICENSE beside this file,
https://github.com/Eugeny/russh), with one change, marked `CORELENS PATCH`
in the source. It is wired in by `[patch.crates-io]` in the workspace's
`Cargo.toml`. This copy goes when a release of russh carries the algorithm,
or makes its MAC table something a caller can add to.

1. `src/mac/crypto.rs`, `src/mac/mod.rs`: the MAC `hmac-sha1-96`
   (RFC 4253 section 6.4). Older switches are still found offering that MAC
   and no other, and the key exchange with one ends in "No common Mac
   algorithm". russh does not implement it and its table of MACs is
   `pub(crate)`, so it cannot be added from outside the crate.
   `TruncatedMacAlgorithm<M, KL, TL>` computes the existing HMAC in full and
   keeps the first `TL` bytes; verifying compares those bytes in constant
   time. `HMAC_SHA1_96` is the name, added to `ALL_MAC_ALGORITHMS` and
   `MACS`. It is not in russh's own default preference list: a caller has to
   ask for it, and Corelens asks for it last.

When moving to a newer russh: copy the new release over this directory,
re-apply the marked blocks, and run
`cargo test -p corelens-discover --test ssh_mac_sha1_96`, which fails
without them.
