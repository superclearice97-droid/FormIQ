package io.github.superclearice97.formiq

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import android.widget.ArrayAdapter
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Bluetooth LE for fitness machines (FTMS) and heart-rate straps, exposed to the web app as navigator.bluetooth. */
@SuppressLint("MissingPermission")
@Suppress("DEPRECATION")
class Ble(private val act: MainActivity, private val emit: (String, JSONObject) -> Unit) {
    private val adapter get() = act.getSystemService(BluetoothManager::class.java)?.adapter
    private val gatts = ConcurrentHashMap<String, BluetoothGatt>()
    private val connectWaits = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    private val opWaits = ConcurrentHashMap<String, CompletableDeferred<ByteArray>>()
    private val locks = ConcurrentHashMap<String, Mutex>()
    private val cccd: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    private fun perms(): Array<String> =
        if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

    private suspend fun ready() {
        val a = adapter ?: throw BridgeError("NotSupportedError", "This phone has no Bluetooth.")
        if (!act.requestPerms(perms())) throw BridgeError("NotAllowedError", "Bluetooth permission was not given. Allow Nearby devices for FormIQ in Settings.")
        if (!a.isEnabled && !act.enableBluetooth()) throw BridgeError("NotAllowedError", "Bluetooth is off.")
    }

    suspend fun request(services: List<String>): JSONObject {
        ready()
        val scanner = adapter?.bluetoothLeScanner ?: throw BridgeError("NotSupportedError", "Bluetooth scanning isn't available.")
        val ids = ArrayList<String>(); val names = ArrayList<String>()
        val result = CompletableDeferred<JSONObject?>()
        val list = ArrayAdapter(act, android.R.layout.simple_list_item_1, names)
        val dialog = AlertDialog.Builder(act)
            .setTitle("Looking for devices… Make sure yours is on and awake.")
            .setAdapter(list) { _, which -> result.complete(JSONObject().put("id", ids[which]).put("name", names[which])) }
            .setNegativeButton("Cancel") { _, _ -> result.complete(null) }
            .setOnCancelListener { result.complete(null) }
            .create()
        val cb = object : ScanCallback() {
            override fun onScanResult(type: Int, r: ScanResult) {
                val addr = r.device.address
                val name = r.scanRecord?.deviceName ?: try { r.device.name } catch (_: SecurityException) { null } ?: "Unnamed device"
                act.runOnUiThread {
                    if (addr !in ids) { ids.add(addr); names.add(name); list.notifyDataSetChanged(); dialog.setTitle("Choose your device") }
                }
            }
            override fun onScanFailed(errorCode: Int) { act.runOnUiThread { result.complete(null) } }
        }
        val filters = services.map { ScanFilter.Builder().setServiceUuid(ParcelUuid(UUID.fromString(it))).build() }
        scanner.startScan(filters, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), cb)
        dialog.show()
        val picked = try { result.await() } finally {
            try { scanner.stopScan(cb) } catch (_: Exception) {}
            if (dialog.isShowing) dialog.dismiss()
        }
        return picked ?: throw BridgeError("NotFoundError", "No device chosen.")
    }

    suspend fun connect(id: String) {
        ready()
        gatts[id]?.let { g -> if (g.services.isNotEmpty()) return }
        val device = adapter?.getRemoteDevice(id) ?: throw BridgeError("NotFoundError", "Device not found.")
        val wait = CompletableDeferred<Unit>(); connectWaits[id] = wait
        val g = device.connectGatt(act, false, callback, BluetoothDevice.TRANSPORT_LE)
        gatts[id] = g
        try { withTimeout(20000) { wait.await() } } catch (e: Exception) {
            if (g.services.isNotEmpty()) { connectWaits.remove(id); return }
            connectWaits.remove(id); gatts.remove(id); try { g.close() } catch (_: Exception) {}
            throw BridgeError("NetworkError", "Couldn't connect. Move closer and try again.")
        }
    }

    fun hasService(id: String, svc: String) = gatts[id]?.getService(UUID.fromString(svc)) != null
    fun hasChar(id: String, svc: String, chr: String) = gatts[id]?.getService(UUID.fromString(svc))?.getCharacteristic(UUID.fromString(chr)) != null
    private fun char(id: String, svc: String, chr: String): Pair<BluetoothGatt, BluetoothGattCharacteristic> {
        val g = gatts[id] ?: throw BridgeError("NetworkError", "Not connected.")
        val c = g.getService(UUID.fromString(svc))?.getCharacteristic(UUID.fromString(chr)) ?: throw BridgeError("NotFoundError", "Not available on this device.")
        return g to c
    }

    /** GATT allows one operation at a time per device: queue them. */
    private suspend fun op(id: String, start: (BluetoothGatt) -> Boolean): ByteArray {
        val g = gatts[id] ?: throw BridgeError("NetworkError", "Not connected.")
        return locks.getOrPut(id) { Mutex() }.withLock {
            val d = CompletableDeferred<ByteArray>(); opWaits[id] = d
            if (!start(g)) { opWaits.remove(id); throw BridgeError("NetworkError", "Bluetooth request failed.") }
            withTimeout(8000) { d.await() }
        }
    }
    private fun opDone(g: BluetoothGatt, value: ByteArray?, status: Int) {
        val d = opWaits.remove(g.device.address) ?: return
        if (status == BluetoothGatt.GATT_SUCCESS) d.complete(value ?: ByteArray(0)) else d.completeExceptionally(BridgeError("NetworkError", "Bluetooth request failed ($status)."))
    }

    suspend fun notify(id: String, svc: String, chr: String, on: Boolean) {
        val (g, c) = char(id, svc, chr)
        g.setCharacteristicNotification(c, on)
        val desc = c.getDescriptor(cccd) ?: return
        val value = when {
            !on -> BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            c.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0 -> BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            else -> BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
        }
        op(id) { gg ->
            if (Build.VERSION.SDK_INT >= 33) gg.writeDescriptor(desc, value) == BluetoothStatusCodes.SUCCESS
            else { desc.value = value; gg.writeDescriptor(desc) }
        }
    }

    suspend fun read(id: String, svc: String, chr: String): String {
        val (_, c) = char(id, svc, chr)
        return Base64.encodeToString(op(id) { gg -> gg.readCharacteristic(c) }, Base64.NO_WRAP)
    }

    suspend fun write(id: String, svc: String, chr: String, b64: String, withResponse: Boolean) {
        val (_, c) = char(id, svc, chr)
        val bytes = Base64.decode(b64, Base64.NO_WRAP)
        val type = if (withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        op(id) { gg ->
            if (Build.VERSION.SDK_INT >= 33) gg.writeCharacteristic(c, bytes, type) == BluetoothStatusCodes.SUCCESS
            else { c.writeType = type; c.value = bytes; gg.writeCharacteristic(c) }
        }
    }

    fun disconnect(id: String) { gatts[id]?.disconnect() }
    fun closeAll() { for (g in gatts.values) try { g.disconnect(); g.close() } catch (_: Exception) {}; gatts.clear() }

    private fun value(g: BluetoothGatt, c: BluetoothGattCharacteristic, v: ByteArray) {
        emit("ble-value", JSONObject().put("dev", g.device.address).put("svc", c.service.uuid.toString()).put("chr", c.uuid.toString()).put("b64", Base64.encodeToString(v, Base64.NO_WRAP)))
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            val id = g.device.address
            if (newState == BluetoothProfile.STATE_CONNECTED) g.discoverServices()
            else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connectWaits.remove(id)?.completeExceptionally(BridgeError("NetworkError", "Disconnected."))
                opWaits.remove(id)?.completeExceptionally(BridgeError("NetworkError", "Disconnected."))
                if (gatts.remove(id) != null) emit("ble-disc", JSONObject().put("dev", id))
                try { g.close() } catch (_: Exception) {}
            }
        }
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            // a larger packet size lets machines send all their numbers in one update; not every device supports it
            if (!g.requestMtu(185)) connectWaits.remove(g.device.address)?.complete(Unit)
        }
        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) { connectWaits.remove(g.device.address)?.complete(Unit) }
        @Deprecated("Android 12 and older")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) { if (Build.VERSION.SDK_INT < 33) value(g, c, c.value ?: ByteArray(0)) }
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, v: ByteArray) { value(g, c, v) }
        @Deprecated("Android 12 and older")
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) { if (Build.VERSION.SDK_INT < 33) opDone(g, c.value, status) }
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, v: ByteArray, status: Int) { opDone(g, v, status) }
        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) { opDone(g, null, status) }
        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) { opDone(g, null, status) }
    }
}
