/*
 * M4Temp.swift
 *
 * Copyright (C) 2026 github.com/geoffsee
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import Foundation
import IOKit

class HIDServiceClient {}

@_silgen_name("IOHIDEventSystemClientCreate")
func IOHIDEventSystemClientCreate(_ allocator: CFAllocator?) -> AnyObject?

@_silgen_name("IOHIDEventSystemClientSetMatching")
func IOHIDEventSystemClientSetMatching(_ client: AnyObject, _ matching: CFDictionary)

@_silgen_name("IOHIDEventSystemClientCopyServices")
func IOHIDEventSystemClientCopyServices(_ client: AnyObject) -> CFArray?

@_silgen_name("IOHIDServiceClientCopyProperty")
func IOHIDServiceClientCopyProperty(_ service: AnyObject, _ property: CFString) -> CFTypeRef?

@_silgen_name("IOHIDServiceClientCopyEvent")
func IOHIDServiceClientCopyEvent(_ service: AnyObject, _ eventType: Int32, _ options: Int32, _ unknown: Int32) -> UnsafeMutableRawPointer?

@_silgen_name("IOHIDEventGetFloatValue")
func IOHIDEventGetFloatValue(_ event: UnsafeMutableRawPointer, _ field: Int32) -> Double

let kIOHIDEventTypeTemperature: Int32 = 15
let kIOHIDEventFieldTemperatureValue: Int32 = (15 << 16)

func getTemps() {
    guard let client = IOHIDEventSystemClientCreate(kCFAllocatorDefault) else {
        return
    }
    
    let matching = [
        "PrimaryUsagePage": 0xFF00,
        "PrimaryUsage": 0x0005
    ] as [String: Any]
    IOHIDEventSystemClientSetMatching(client, matching as CFDictionary)
    
    guard let services = IOHIDEventSystemClientCopyServices(client) as? [AnyObject] else {
        return
    }
    
    var results: [String: Double] = [:]
    
    for service in services {
        if let product = IOHIDServiceClientCopyProperty(service, "Product" as CFString) as? String {
            if product.contains("PMU tdie") || product.contains("PMU tcal") {
                if let event = IOHIDServiceClientCopyEvent(service, kIOHIDEventTypeTemperature, 0, 0) {
                    let temp = IOHIDEventGetFloatValue(event, kIOHIDEventFieldTemperatureValue)
                    if temp > 0 {
                        results[product] = temp
                    }
                }
            }
        }
    }
    
    if let jsonData = try? JSONSerialization.data(withJSONObject: results, options: .prettyPrinted),
       let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
    }
}

getTemps()
