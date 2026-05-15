/**
 * RegionSelector Component
 * Provides city selection for project setup with auto-configuration
 * Integrates IS Code regional design conditions
 * 
 * Used in: ProjectSetupDialog
 */

import React, { useState } from 'react';
import {
  getIndianCities,
  autoConfigureDesignConditions,
  determineStandardForRegion,
  AutoConfiguredDesignCondition,
} from '../lib/regional-design-conditions';

export interface RegionSelectorProps {
  onRegionSelect: (
    config: AutoConfiguredDesignCondition,
    standard: 'IS_CODE' | 'ASHRAE'
  ) => void;
  defaultRegion?: string;
}

export const RegionSelector: React.FC<RegionSelectorProps> = ({
  onRegionSelect,
  defaultRegion = 'delhi',
}) => {
  const [selectedCity, setSelectedCity] = useState<string>(defaultRegion);
  const [selectedConfig, setSelectedConfig] = useState<AutoConfiguredDesignCondition | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const indianCities = getIndianCities();

  const handleCityChange = (cityKey: string) => {
    setSelectedCity(cityKey);
    
    try {
      const config = autoConfigureDesignConditions(cityKey);
      setSelectedConfig(config);
      
      // Determine standard for this region
      const standardResult = determineStandardForRegion('IN');
      
      // Notify parent
      onRegionSelect(config, standardResult.standard);
    } catch (error) {
      console.error('Error configuring region:', error);
    }
  };

  const handleSubmit = () => {
    if (selectedConfig) {
      const standardResult = determineStandardForRegion('IN');
      onRegionSelect(selectedConfig, standardResult.standard);
    }
  };

  return (
    <div className="space-y-6 p-6 bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg border border-slate-200">
      {/* Title */}
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Project Region</h3>
        <p className="text-sm text-slate-600 mt-1">
          Select your location to auto-configure design conditions per IS Code
        </p>
      </div>

      {/* City Selector */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">
          Select City
        </label>
        <select
          value={selectedCity}
          onChange={(e) => handleCityChange(e.target.value)}
          className="w-full px-4 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900"
        >
          <option value="">-- Choose a city --</option>
          {indianCities.map((city) => (
            <option key={city.key} value={city.key}>
              {city.name}, {city.state}
            </option>
          ))}
        </select>
      </div>

      {/* Selected Configuration Display */}
      {selectedConfig && (
        <>
          {/* Summary Card */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-semibold text-slate-900">
                  {selectedConfig.city}
                </h4>
                <p className="text-sm text-slate-600">
                  {selectedConfig.climate_zone} Climate | Altitude: {selectedConfig.altitude_ft} ft
                </p>
              </div>
              <span className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full border border-blue-200">
                IS Code Locked
              </span>
            </div>

            {/* Design Conditions Grid */}
            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-200">
              {/* Summer */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  Summer Design
                </p>
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Dry Bulb:</span>
                    <span className="font-semibold text-slate-900">
                      {selectedConfig.summer.db}°C ({selectedConfig.summer.db_f}°F)
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Wet Bulb:</span>
                    <span className="font-semibold text-slate-900">
                      {selectedConfig.summer.wb}°C
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">RH:</span>
                    <span className="font-semibold text-slate-900">
                      {selectedConfig.summer.rh}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Monsoon */}
              {selectedConfig.monsoon && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                    Monsoon Design
                  </p>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-600">Dry Bulb:</span>
                      <span className="font-semibold text-slate-900">
                        {selectedConfig.monsoon.db}°C
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-600">RH:</span>
                      <span className="font-semibold text-slate-900 text-orange-600">
                        {selectedConfig.monsoon.rh}% ⚠
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Safety Factors */}
            <div className="pt-3 border-t border-slate-200 space-y-2">
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                IS Code Safety Factors
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded p-2">
                  <span className="text-xs text-slate-600">Sensible:</span>
                  <p className="font-semibold text-slate-900">
                    +{selectedConfig.sensible_safety_percent}%
                  </p>
                </div>
                <div className="bg-slate-50 rounded p-2">
                  <span className="text-xs text-slate-600">Latent:</span>
                  <p className="font-semibold text-slate-900">
                    +{selectedConfig.latent_safety_percent}%
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Details Section (Collapsible) */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-2"
          >
            <span>{showDetails ? '−' : '+'}</span>
            {showDetails ? 'Hide' : 'Show'} Climate Details
          </button>

          {showDetails && selectedConfig.notes && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900 whitespace-pre-line font-mono text-xs leading-relaxed">
                {selectedConfig.notes}
              </p>
            </div>
          )}

          {/* Confirmation */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-green-900 text-sm">
                IS Code Compliance Confirmed
              </p>
              <p className="text-xs text-green-800 mt-1">
                This project will use IS Code standards (IS 12273, IS 3720, IS 4257) for all calculations.
              </p>
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={handleSubmit}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Confirm Region & Proceed
          </button>
        </>
      )}

      {/* Initial State (No City Selected) */}
      {!selectedConfig && (
        <div className="text-center py-8">
          <p className="text-slate-600 text-sm">
            Select a city above to see design conditions
          </p>
        </div>
      )}

      {/* Footer Info */}
      <div className="text-xs text-slate-600 border-t border-slate-200 pt-4">
        <p className="font-medium text-slate-700 mb-2">ℹ What's Auto-Configured?</p>
        <ul className="space-y-1 ml-4 list-disc">
          <li>Design temperatures from IS 12273</li>
          <li>Monsoon humidity conditions</li>
          <li>IS Code safety factors (sensible/latent)</li>
          <li>Standard locked to IS Code (non-negotiable for India)</li>
        </ul>
      </div>
    </div>
  );
};

export default RegionSelector;
