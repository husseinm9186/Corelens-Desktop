use std::marker::PhantomData;

use byteorder::{BigEndian, ByteOrder};
use digest::typenum::Unsigned;
use digest::{KeyInit, OutputSizeUser};
use generic_array::{ArrayLength, GenericArray};
use subtle::ConstantTimeEq;

use super::{Mac, MacAlgorithm};

pub struct CryptoMacAlgorithm<
    M: digest::Mac + KeyInit + Send + 'static,
    KL: ArrayLength + 'static,
>(pub PhantomData<M>, pub PhantomData<KL>);

pub struct CryptoMac<M: digest::Mac + KeyInit + Send + 'static, KL: ArrayLength + 'static> {
    pub(crate) key: GenericArray<u8, KL>,
    pub(crate) p: PhantomData<M>,
}

impl<M: digest::Mac + KeyInit + Send + 'static, KL: ArrayLength + 'static> MacAlgorithm
    for CryptoMacAlgorithm<M, KL>
where
    <M as OutputSizeUser>::OutputSize: ArrayLength,
{
    fn key_len(&self) -> usize {
        KL::to_usize()
    }

    fn make_mac(&self, mac_key: &[u8]) -> Box<dyn Mac + Send> {
        let mut key = GenericArray::<u8, KL>::default();
        key.copy_from_slice(mac_key);
        Box::new(CryptoMac::<M, KL> {
            key,
            p: PhantomData,
        }) as Box<dyn Mac + Send>
    }
}

impl<M: digest::Mac + KeyInit + Send + 'static, KL: ArrayLength + 'static> Mac for CryptoMac<M, KL>
where
    <M as OutputSizeUser>::OutputSize: ArrayLength,
{
    fn mac_len(&self) -> usize {
        M::OutputSize::to_usize()
    }

    fn compute(&self, sequence_number: u32, payload: &[u8], output: &mut [u8]) {
        #[allow(clippy::unwrap_used)]
        let mut hmac = <M as KeyInit>::new_from_slice(&self.key).unwrap();
        let mut seqno_buf = [0; 4];
        BigEndian::write_u32(&mut seqno_buf, sequence_number);
        hmac.update(&seqno_buf);
        hmac.update(payload);
        output.copy_from_slice(&hmac.finalize().into_bytes());
    }

    fn verify(&self, sequence_number: u32, payload: &[u8], mac: &[u8]) -> bool {
        let mut buf = GenericArray::<u8, M::OutputSize>::default();
        self.compute(sequence_number, payload, &mut buf);
        buf.ct_eq(mac).into()
    }
}

// CORELENS PATCH: a truncated HMAC (RFC 4253 section 6.4, `hmac-sha1-96`).
// The MAC is computed in full by the same code as above and only its first
// `TL` bytes are sent and compared. See CORELENS-PATCHES.md.
pub struct TruncatedMacAlgorithm<
    M: digest::Mac + KeyInit + Send + 'static,
    KL: ArrayLength + 'static,
    TL: Unsigned + 'static,
>(pub PhantomData<M>, pub PhantomData<KL>, pub PhantomData<TL>);

pub struct TruncatedMac<
    M: digest::Mac + KeyInit + Send + 'static,
    KL: ArrayLength + 'static,
    TL: Unsigned + 'static,
> {
    pub(crate) full: CryptoMac<M, KL>,
    pub(crate) p: PhantomData<TL>,
}

impl<M: digest::Mac + KeyInit + Send + 'static, KL: ArrayLength + 'static, TL: Unsigned + Send + 'static>
    MacAlgorithm for TruncatedMacAlgorithm<M, KL, TL>
where
    <M as OutputSizeUser>::OutputSize: ArrayLength,
{
    fn key_len(&self) -> usize {
        KL::to_usize()
    }

    fn make_mac(&self, mac_key: &[u8]) -> Box<dyn Mac + Send> {
        let mut key = GenericArray::<u8, KL>::default();
        key.copy_from_slice(mac_key);
        Box::new(TruncatedMac::<M, KL, TL> {
            full: CryptoMac::<M, KL> {
                key,
                p: PhantomData,
            },
            p: PhantomData,
        }) as Box<dyn Mac + Send>
    }
}

impl<M: digest::Mac + KeyInit + Send + 'static, KL: ArrayLength + 'static, TL: Unsigned + Send + 'static> Mac
    for TruncatedMac<M, KL, TL>
where
    <M as OutputSizeUser>::OutputSize: ArrayLength,
{
    fn mac_len(&self) -> usize {
        TL::to_usize()
    }

    fn compute(&self, sequence_number: u32, payload: &[u8], output: &mut [u8]) {
        let mut buf = GenericArray::<u8, M::OutputSize>::default();
        self.full.compute(sequence_number, payload, &mut buf);
        #[allow(clippy::indexing_slicing)] // TL is never longer than the MAC it shortens
        output.copy_from_slice(&buf[..TL::to_usize()]);
    }

    fn verify(&self, sequence_number: u32, payload: &[u8], mac: &[u8]) -> bool {
        let mut buf = GenericArray::<u8, M::OutputSize>::default();
        self.full.compute(sequence_number, payload, &mut buf);
        #[allow(clippy::indexing_slicing)]
        let ours = &buf[..TL::to_usize()];
        // Constant time, and a MAC of any other length is simply wrong.
        mac.len() == ours.len() && bool::from(ours.ct_eq(mac))
    }
}
// END CORELENS PATCH
