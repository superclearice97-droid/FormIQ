package io.github.superclearice97.formiq

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The key that encrypts FormIQ's saved data. A random 256-bit data key is stored only in wrapped
 * (encrypted) form; the wrapping key lives in the Android Keystore (secure hardware where available)
 * and can never be read out of it. The data key is unwrapped in memory for the running app only.
 */
object Vault {
    private const val ALIAS = "formiq-vault-v1"
    private const val PREFS = "formiq-vault"

    private fun keystore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun wrappingKey(): SecretKey {
        (keystore().getKey(ALIAS, null) as? SecretKey)?.let { return it }
        fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .apply { if (strongBox && Build.VERSION.SDK_INT >= 28) setIsStrongBoxBacked(true) }
            .build()
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        return try { gen.init(spec(true)); gen.generateKey() }
        catch (e: Exception) { gen.init(spec(false)); gen.generateKey() }      // no StrongBox chip: use the regular secure keystore
    }

    @Synchronized
    fun dataKey(ctx: Context): ByteArray {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val kek = wrappingKey()
        prefs.getString("wrapped", null)?.let { stored ->
            val b = Base64.decode(stored, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, kek, GCMParameterSpec(128, b.copyOfRange(0, 12)))
            return c.doFinal(b, 12, b.size - 12)
        }
        val raw = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, kek)
        val wrapped = c.iv + c.doFinal(raw)
        prefs.edit().putString("wrapped", Base64.encodeToString(wrapped, Base64.NO_WRAP)).commit()
        return raw
    }

    @Synchronized
    fun destroy(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
        try { keystore().deleteEntry(ALIAS) } catch (_: Exception) {}
    }
}
