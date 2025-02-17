import zipfile 
import os 
import fiona 
import pandas as pd 
import geopandas as gpd 


class KmzConverter():
    KML_FILE = "data/doc.kml"

    def extract_kml(self):
        kmz_file_path = "data/EV-friendly hotels in Europe.kmz"  
        extraction_dir = os.path.dirname("data/")
        fiona.drvsupport.supported_drivers["libkml"] = "rw" 
        fiona.drvsupport.supported_drivers["LIBKML"] = "rw"
        with zipfile.ZipFile(kmz_file_path, "r") as kmz:
            kmz.extractall(extraction_dir)

    def get_kml_layers(self, kml_file):
        layers_list = []
        for layer in fiona.listlayers(kml_file) :    
            df = gpd.read_file(kml_file, driver="LIBKML", layer=layer)
            layers_list.append(df)
        return self.create_csv(layers_list)

    def create_csv(self, func_get_kml_layers):
        df = gpd.GeoDataFrame(pd.concat(func_get_kml_layers, ignore_index=True))
        df_columns = [col for col in df.columns]
        if "geometry" in df_columns:
            df["geometry"] = df["geometry"].astype(str)

        df[["longitude", "latitude"]] = df["geometry"].str.extract(r'POINT Z?\s*\(([-\d.]+) ([-\d.]+)(?: [-\d.]*)?\)')
        df[["longitude", "latitude"]] = df[["longitude", "latitude"]].astype(float)
        df["Maps link"] = df.apply(lambda row: f"https://www.google.com/maps/place/{row['latitude']},{row['longitude']}", axis=1)
        df.drop(columns=["geometry"], inplace=True)
        df.to_csv("data/EV-friendly hotels in Europe.csv", index=False)


if __name__ == "__main__":
    converter = KmzConverter()
    converter.extract_kml()
    converter.get_kml_layers(converter.KML_FILE)